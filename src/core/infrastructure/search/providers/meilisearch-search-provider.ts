import type { SearchDocument, SearchDocumentKind } from "@/domain/entities/search-document";
import type {
  SearchIndexFilter,
  SearchIndexProvider,
  SearchIndexQuery,
  SearchIndexQueryResult,
  SearchProviderStatus,
} from "@/application/ports/search-index-provider";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * `SearchIndexProvider` over Meilisearch. This file (and its Typesense
 * sibling) is the *only* place in the codebase allowed to know that
 * Meilisearch exists — the application layer talks to the port, and the
 * translation from the port's closed, plain-object query into
 * Meilisearch's filter DSL happens entirely below this line.
 *
 * ## Why the client is a narrow structural interface, not `MeiliSearch`
 * The constructor takes `MeilisearchClientApi` — a hand-written interface
 * describing exactly the five calls this provider makes — rather than the
 * SDK's own client class. The real `MeiliSearch` instance satisfies it
 * structurally and is what `search-provider-factory.ts` passes in
 * production. The gain is that this class's behaviour (filter-string
 * construction, sort translation, score normalization, pagination
 * arithmetic) is unit-testable against a small recording fake, with no
 * HTTP, no running engine, and no dependency on SDK internals that change
 * between majors. It also keeps the SDK import in exactly one file: the
 * factory.
 *
 * ## Index settings are asserted lazily, once
 * Meilisearch rejects a filter on an attribute that was never declared
 * `filterable`, and ignores a sort on one that is not `sortable`.
 * `ensureSettings()` declares both on first use and remembers it did, so
 * a fresh index self-configures rather than requiring an out-of-band
 * provisioning step that could be forgotten in one environment.
 */

export interface MeilisearchSearchResponse {
  hits: Record<string, unknown>[];
  estimatedTotalHits?: number;
  totalHits?: number;
  processingTimeMs?: number;
}

export interface MeilisearchIndexApi {
  addDocuments(documents: Record<string, unknown>[], options?: { primaryKey?: string }): Promise<unknown>;
  deleteDocument(documentId: string): Promise<unknown>;
  deleteDocuments(params: { filter: string }): Promise<unknown>;
  search(query: string, params: Record<string, unknown>): Promise<MeilisearchSearchResponse>;
  getStats(): Promise<{ numberOfDocuments: number }>;
  updateSettings(settings: Record<string, unknown>): Promise<unknown>;
}

export interface MeilisearchClientApi {
  index(uid: string): MeilisearchIndexApi;
  health(): Promise<{ status: string }>;
}

/** Attributes the engine must be told about for filtering/sorting to work. */
const FILTERABLE_ATTRIBUTES = [
  "kind",
  "entityId",
  "categoryIds",
  "city",
  "province",
  "isVerified",
  "averageRating",
  "reviewCount",
  "indexedAtMs",
  "_geo",
];
const SORTABLE_ATTRIBUTES = ["averageRating", "reviewCount", "createdAtMs", "_geo"];
const SEARCHABLE_ATTRIBUTES = ["title", "subtitle", "text"];

export class MeilisearchSearchProvider implements SearchIndexProvider {
  readonly name = "meilisearch";

  private settingsAsserted = false;

  constructor(
    private readonly client: MeilisearchClientApi,
    private readonly indexName: string,
  ) {}

  async indexDocument(document: SearchDocument): Promise<void> {
    await this.indexDocuments([document]);
  }

  async indexDocuments(documents: SearchDocument[]): Promise<void> {
    if (documents.length === 0) return;
    await this.ensureSettings();
    // `addDocuments` is an upsert keyed by the primary key, which is why
    // deterministic document ids are enough to make indexing idempotent —
    // no read-before-write, no version check.
    await this.index().addDocuments(documents.map(toMeilisearchDocument), { primaryKey: "id" });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.index().deleteDocument(documentId);
  }

  async deleteByFilter(filter: SearchIndexFilter): Promise<number> {
    await this.ensureSettings();

    const clauses = buildFilterClauses(filter);
    if (clauses.length === 0) {
      // Deleting "everything" via an empty filter would be a footgun in a
      // shared index; the port allows it, but it must be spelled out
      // rather than produced by an accidentally-empty filter object.
      clauses.push("id EXISTS");
    }

    // Meilisearch's delete-by-filter is asynchronous (it returns a task),
    // so an exact count is not available synchronously. The count is
    // asked for first, purely so callers get a truthful number for
    // observability; a small drift under concurrent writes is acceptable
    // for a progress figure and never used for control flow.
    const matched = await this.countByFilter(clauses);
    await this.index().deleteDocuments({ filter: clauses.join(" AND ") });
    return matched;
  }

  async countDocuments(kind?: SearchDocumentKind): Promise<number> {
    if (!kind) {
      const stats = await this.index().getStats();
      return stats.numberOfDocuments;
    }
    return this.countByFilter([`kind = "${kind}"`]);
  }

  async search(query: SearchIndexQuery): Promise<SearchIndexQueryResult> {
    await this.ensureSettings();

    const filters = buildQueryFilters(query);
    const page = Math.max(1, query.page);
    const pageSize = Math.max(1, query.pageSize);

    const response = await this.index().search(query.text ?? "", {
      // Meilisearch's own pagination is 1-based on `page`, and `hitsPerPage`
      // switches it into exhaustive-count mode, which is what makes
      // `totalHits` an exact total rather than an estimate — the read model
      // reports a real result count, not an approximation.
      page,
      hitsPerPage: pageSize,
      filter: filters.length > 0 ? filters.join(" AND ") : undefined,
      sort: buildSort(query),
      showRankingScore: true,
      // Typo tolerance is the engine's default; `fuzzy: false` turns it
      // off per query rather than per index, so an exact-match caller
      // never has to reconfigure (or wait for) a settings update.
      ...(query.fuzzy === false ? { matchingStrategy: "all", typoTolerance: { enabled: false } } : {}),
    });

    return {
      hits: response.hits.map((hit) => ({
        document: fromMeilisearchDocument(hit),
        score: typeof hit._rankingScore === "number" ? hit._rankingScore : 0,
        distanceKm: typeof hit._geoDistance === "number" ? hit._geoDistance / 1000 : null,
      })),
      total: response.totalHits ?? response.estimatedTotalHits ?? response.hits.length,
      page,
      pageSize,
      tookMs: response.processingTimeMs ?? 0,
    };
  }

  async ping(): Promise<SearchProviderStatus> {
    const startedAt = Date.now();
    try {
      const health = await this.client.health();
      const stats = await this.index().getStats();
      return {
        provider: this.name,
        reachable: health.status === "available",
        documentCount: stats.numberOfDocuments,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      // Contractually never throws — see `SearchIndexProvider.ping`.
      return {
        provider: this.name,
        reachable: false,
        documentCount: null,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private index(): MeilisearchIndexApi {
    return this.client.index(this.indexName);
  }

  private async ensureSettings(): Promise<void> {
    if (this.settingsAsserted) return;
    this.settingsAsserted = true;
    await this.index().updateSettings({
      searchableAttributes: SEARCHABLE_ATTRIBUTES,
      filterableAttributes: FILTERABLE_ATTRIBUTES,
      sortableAttributes: SORTABLE_ATTRIBUTES,
    });
  }

  private async countByFilter(clauses: string[]): Promise<number> {
    const response = await this.index().search("", {
      filter: clauses.join(" AND "),
      page: 1,
      hitsPerPage: 1,
    });
    return response.totalHits ?? response.estimatedTotalHits ?? 0;
  }
}

/**
 * Adds the two engine-shaped projections Meilisearch needs and the read
 * model does not carry natively: `_geo` (its reserved geo field) and
 * numeric mirrors of the ISO timestamps, since a lexicographic sort on an
 * ISO string is only accidentally correct and filtering on one is not
 * supported at all. The original ISO fields are kept verbatim so a
 * document round-trips back into a `SearchDocument` unchanged.
 */
function toMeilisearchDocument(document: SearchDocument): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...document,
    createdAtMs: Date.parse(document.createdAt),
    indexedAtMs: Date.parse(document.indexedAt),
  };
  if (document.latitude !== null && document.longitude !== null) {
    payload._geo = { lat: document.latitude, lng: document.longitude };
  }
  return payload;
}

function fromMeilisearchDocument(hit: Record<string, unknown>): SearchDocument {
  return {
    id: String(hit.id),
    kind: hit.kind as SearchDocumentKind,
    entityId: String(hit.entityId),
    title: String(hit.title ?? ""),
    subtitle: (hit.subtitle as string | null) ?? null,
    text: String(hit.text ?? ""),
    categoryIds: Array.isArray(hit.categoryIds) ? (hit.categoryIds as string[]) : [],
    city: (hit.city as string | null) ?? null,
    province: (hit.province as string | null) ?? null,
    latitude: (hit.latitude as number | null) ?? null,
    longitude: (hit.longitude as number | null) ?? null,
    isVerified: Boolean(hit.isVerified),
    averageRating: (hit.averageRating as number | null) ?? null,
    reviewCount: Number(hit.reviewCount ?? 0),
    portfolioItemCount: Number(hit.portfolioItemCount ?? 0),
    createdAt: String(hit.createdAt),
    indexedAt: String(hit.indexedAt),
  };
}

function buildFilterClauses(filter: SearchIndexFilter): string[] {
  const clauses: string[] = [];
  if (filter.kind) clauses.push(`kind = "${filter.kind}"`);
  if (filter.entityId) clauses.push(`entityId = "${filter.entityId}"`);
  if (filter.indexedBefore) clauses.push(`indexedAtMs < ${Date.parse(filter.indexedBefore)}`);
  return clauses;
}

function buildQueryFilters(query: SearchIndexQuery): string[] {
  const filters: string[] = [];

  if (query.kinds && query.kinds.length > 0) {
    filters.push(`(${query.kinds.map((kind) => `kind = "${kind}"`).join(" OR ")})`);
  }
  if (query.categoryIds && query.categoryIds.length > 0) {
    filters.push(`(${query.categoryIds.map((id) => `categoryIds = "${id}"`).join(" OR ")})`);
  }
  if (query.city) filters.push(`city = "${escapeValue(query.city)}"`);
  if (query.province) filters.push(`province = "${escapeValue(query.province)}"`);
  if (query.verifiedOnly) filters.push("isVerified = true");
  if (query.minRating !== undefined) filters.push(`averageRating >= ${query.minRating}`);
  if (query.minReviewCount !== undefined) filters.push(`reviewCount >= ${query.minReviewCount}`);
  if (query.near?.radiusKm !== undefined) {
    filters.push(`_geoRadius(${query.near.latitude}, ${query.near.longitude}, ${query.near.radiusKm * 1000})`);
  }

  return filters;
}

function buildSort(query: SearchIndexQuery): string[] | undefined {
  switch (query.sort) {
    case "RATING":
      return ["averageRating:desc"];
    case "REVIEWS":
      return ["reviewCount:desc"];
    case "NEWEST":
      return ["createdAtMs:desc"];
    case "DISTANCE":
      return query.near ? [`_geoPoint(${query.near.latitude}, ${query.near.longitude}):asc`] : undefined;
    default:
      // Undefined means "the engine's own ranking rules" — which is
      // exactly what RELEVANCE should be, rather than a hand-rolled
      // approximation of it.
      return undefined;
  }
}

/** Meilisearch filter values are double-quoted strings; escape the quote and backslash. */
function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
