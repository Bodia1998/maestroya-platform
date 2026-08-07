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
 * `SearchIndexProvider` over Typesense — the second concrete engine, and
 * the reason the port earns its keep. Meilisearch and Typesense have
 * genuinely different dialects (`kind = "X"` vs `kind:=X`,
 * `_geoRadius(...)` vs `location:(lat, lng, r km)`, task-based deletes vs
 * synchronous ones, a 0..1 `_rankingScore` vs a large integer
 * `text_match`), and every one of those differences is absorbed in this
 * file. Nothing above `infrastructure/search/providers/` can tell which
 * engine is running; swapping them is a single env var.
 *
 * Same structural-interface approach as the Meilisearch provider (see its
 * doc comment for the full reasoning): the constructor takes the narrow
 * `TypesenseClientApi` this provider actually uses, the real SDK client
 * satisfies it, and only `search-provider-factory.ts` imports the SDK.
 */

export interface TypesenseSearchHit {
  document: Record<string, unknown>;
  text_match?: number;
  geo_distance_meters?: Record<string, number>;
}

export interface TypesenseSearchResponse {
  found: number;
  page?: number;
  search_time_ms?: number;
  hits?: TypesenseSearchHit[];
}

export interface TypesenseDocumentsApi {
  import(documents: Record<string, unknown>[], options: { action: string }): Promise<unknown>;
  delete(params: { filter_by: string }): Promise<{ num_deleted: number }>;
  search(params: Record<string, unknown>): Promise<TypesenseSearchResponse>;
}

export interface TypesenseCollectionApi {
  documents(): TypesenseDocumentsApi;
  documents(documentId: string): { delete(): Promise<unknown> };
  retrieve(): Promise<{ num_documents: number }>;
}

export interface TypesenseClientApi {
  collections(name: string): TypesenseCollectionApi;
  health: { retrieve(): Promise<{ ok: boolean }> };
}

/**
 * Typesense's `text_match` is an opaque, very large integer (it packs
 * several match signals into one 64-bit value), not a 0..1 score. The
 * port promises a normalized score, so it is divided by the documented
 * maximum. The absolute value is meaningless either way — only the
 * ordering is — but a consistent range across providers is what lets one
 * set of read-side tests and one UI treat every engine identically.
 */
const TYPESENSE_MAX_TEXT_MATCH = 1_157_451_471_441_100_800;

export class TypesenseSearchProvider implements SearchIndexProvider {
  readonly name = "typesense";

  constructor(
    private readonly client: TypesenseClientApi,
    private readonly collectionName: string,
  ) {}

  async indexDocument(document: SearchDocument): Promise<void> {
    await this.indexDocuments([document]);
  }

  async indexDocuments(documents: SearchDocument[]): Promise<void> {
    if (documents.length === 0) return;
    // `action: "upsert"` is what makes a re-index idempotent: same
    // deterministic id, one document, no duplicates and no conflict error.
    await this.collection().documents().import(documents.map(toTypesenseDocument), { action: "upsert" });
  }

  async deleteDocument(documentId: string): Promise<void> {
    try {
      await this.collection().documents(documentId).delete();
    } catch (error) {
      // Typesense 404s on deleting an absent document; the port requires
      // that to be a no-op, since a duplicate delete job (or a delete
      // racing a rebuild sweep) must converge rather than fail forever.
      if (!isNotFound(error)) throw error;
    }
  }

  async deleteByFilter(filter: SearchIndexFilter): Promise<number> {
    const clauses = buildFilterClauses(filter);
    // Typesense requires a non-empty `filter_by`; `id:!=null` is its
    // idiom for "everything".
    const filterBy = clauses.length > 0 ? clauses.join(" && ") : "id:!=null";
    const result = await this.collection().documents().delete({ filter_by: filterBy });
    return result.num_deleted;
  }

  async countDocuments(kind?: SearchDocumentKind): Promise<number> {
    if (!kind) {
      const collection = await this.collection().retrieve();
      return collection.num_documents;
    }
    const response = await this.collection()
      .documents()
      .search({ q: "*", filter_by: `kind:=${kind}`, per_page: 1, page: 1 });
    return response.found;
  }

  async search(query: SearchIndexQuery): Promise<SearchIndexQueryResult> {
    const page = Math.max(1, query.page);
    const pageSize = Math.max(1, query.pageSize);
    const filters = buildQueryFilters(query);

    const response = await this.collection()
      .documents()
      .search({
        // `*` is Typesense's match-all query — the correct spelling of "no
        // text, just filters", which is a normal read-model request
        // (browse by category/city with no search box input).
        q: query.text && query.text.length > 0 ? query.text : "*",
        query_by: "title,subtitle,text",
        // Field weights mirror the in-memory provider's, so ranking is
        // recognisably the same product behaviour on either engine.
        query_by_weights: "3,2,1",
        filter_by: filters.length > 0 ? filters.join(" && ") : undefined,
        sort_by: buildSort(query),
        page,
        per_page: pageSize,
        // 0 typos = exact matching; 2 is Typesense's own default.
        num_typos: query.fuzzy === false ? 0 : 2,
      });

    const hits = response.hits ?? [];

    return {
      hits: hits.map((hit) => ({
        document: fromTypesenseDocument(hit.document),
        score: hit.text_match ? Math.min(1, hit.text_match / TYPESENSE_MAX_TEXT_MATCH) : 0,
        distanceKm: readGeoDistanceKm(hit),
      })),
      total: response.found,
      page,
      pageSize,
      tookMs: response.search_time_ms ?? 0,
    };
  }

  async ping(): Promise<SearchProviderStatus> {
    const startedAt = Date.now();
    try {
      const health = await this.client.health.retrieve();
      const collection = await this.collection().retrieve();
      return {
        provider: this.name,
        reachable: health.ok === true,
        documentCount: collection.num_documents,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        provider: this.name,
        reachable: false,
        documentCount: null,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private collection(): TypesenseCollectionApi {
    return this.client.collections(this.collectionName);
  }
}

/**
 * Typesense wants geo as a `[lat, lng]` tuple field and cannot filter or
 * sort on a string timestamp, hence the numeric mirrors — the same two
 * engine-shaped additions the Meilisearch provider makes, spelled
 * Typesense's way. A document with no coordinates simply omits
 * `location`, which Typesense treats as "not geo-searchable" rather than
 * as an error.
 */
function toTypesenseDocument(document: SearchDocument): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...document,
    createdAtMs: Date.parse(document.createdAt),
    indexedAtMs: Date.parse(document.indexedAt),
  };
  if (document.latitude !== null && document.longitude !== null) {
    payload.location = [document.latitude, document.longitude];
  }
  return payload;
}

function fromTypesenseDocument(raw: Record<string, unknown>): SearchDocument {
  return {
    id: String(raw.id),
    kind: raw.kind as SearchDocumentKind,
    entityId: String(raw.entityId),
    title: String(raw.title ?? ""),
    subtitle: (raw.subtitle as string | null) ?? null,
    text: String(raw.text ?? ""),
    categoryIds: Array.isArray(raw.categoryIds) ? (raw.categoryIds as string[]) : [],
    city: (raw.city as string | null) ?? null,
    province: (raw.province as string | null) ?? null,
    latitude: (raw.latitude as number | null) ?? null,
    longitude: (raw.longitude as number | null) ?? null,
    isVerified: Boolean(raw.isVerified),
    averageRating: (raw.averageRating as number | null) ?? null,
    reviewCount: Number(raw.reviewCount ?? 0),
    portfolioItemCount: Number(raw.portfolioItemCount ?? 0),
    createdAt: String(raw.createdAt),
    indexedAt: String(raw.indexedAt),
  };
}

function readGeoDistanceKm(hit: TypesenseSearchHit): number | null {
  const distances = hit.geo_distance_meters;
  if (!distances) return null;
  const meters = distances.location;
  return typeof meters === "number" ? meters / 1000 : null;
}

function buildFilterClauses(filter: SearchIndexFilter): string[] {
  const clauses: string[] = [];
  if (filter.kind) clauses.push(`kind:=${filter.kind}`);
  if (filter.entityId) clauses.push(`entityId:=${filter.entityId}`);
  if (filter.indexedBefore) clauses.push(`indexedAtMs:<${Date.parse(filter.indexedBefore)}`);
  return clauses;
}

function buildQueryFilters(query: SearchIndexQuery): string[] {
  const filters: string[] = [];

  if (query.kinds && query.kinds.length > 0) filters.push(`kind:=[${query.kinds.join(",")}]`);
  if (query.categoryIds && query.categoryIds.length > 0) {
    filters.push(`categoryIds:=[${query.categoryIds.join(",")}]`);
  }
  if (query.city) filters.push(`city:=${escapeValue(query.city)}`);
  if (query.province) filters.push(`province:=${escapeValue(query.province)}`);
  if (query.verifiedOnly) filters.push("isVerified:=true");
  if (query.minRating !== undefined) filters.push(`averageRating:>=${query.minRating}`);
  if (query.minReviewCount !== undefined) filters.push(`reviewCount:>=${query.minReviewCount}`);
  if (query.near?.radiusKm !== undefined) {
    filters.push(`location:(${query.near.latitude}, ${query.near.longitude}, ${query.near.radiusKm} km)`);
  }

  return filters;
}

function buildSort(query: SearchIndexQuery): string | undefined {
  switch (query.sort) {
    case "RATING":
      return "averageRating:desc";
    case "REVIEWS":
      return "reviewCount:desc";
    case "NEWEST":
      return "createdAtMs:desc";
    case "DISTANCE":
      return query.near ? `location(${query.near.latitude}, ${query.near.longitude}):asc` : undefined;
    default:
      // Typesense's default is `_text_match:desc`, its own relevance
      // ranking — left unspecified for the same reason as Meilisearch.
      return undefined;
  }
}

/** Typesense filter values are backtick-quoted when they may contain separators. */
function escapeValue(value: string): string {
  return `\`${value.replace(/`/g, "")}\``;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { httpStatus?: number }).httpStatus;
  if (status === 404) return true;
  return error instanceof Error && /not found/i.test(error.message);
}
