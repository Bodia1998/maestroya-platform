import type { SearchDocument, SearchDocumentKind } from "@/domain/entities/search-document";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The technology-agnostic seam between the search read model and whatever
 * engine actually stores it — the search analogue of Module 46's
 * `CacheProvider` and Module 45's `JobStore`, and the reason the
 * application layer never imports `meilisearch` or `typesense`.
 *
 * Three implementations exist (`infrastructure/search/providers/`):
 * Meilisearch, Typesense, and an in-process one. Which is used is decided
 * once, from the validated env, by `search-provider-factory.ts` — no
 * caller passes or knows the choice.
 *
 * ## Why nothing engine-shaped leaks through here
 * Not one member below accepts a filter DSL string, a "facet", a
 * `sort: ["rating:desc"]` array, or any other engine dialect. Filters are
 * a plain, closed `SearchIndexQuery` object and each provider translates
 * it into its own dialect internally. That is the whole point of the
 * port: if the platform swaps Meilisearch for Typesense (or for
 * Postgres full-text, or for Elasticsearch), the diff is one new file in
 * `infrastructure/search/providers/` plus one env var — no use case, no
 * test of a use case, and no domain type changes.
 *
 * ## Every method may fail, and failure is survivable
 * The search engine is an *optional, degradable* dependency by explicit
 * design (the same category `/api/health/ready` puts Redis, the queue,
 * and the caching layer in). Implementations are therefore allowed to
 * throw on a backend failure — they must not silently pretend success —
 * and the layers above decide what that means: indexing use cases let it
 * throw so the background job retries with backoff and eventually
 * dead-letters, while the read-side `SearchReadModelUseCase` catches it
 * and degrades to an empty, explicitly-flagged result so a page never
 * 500s because the search engine is down.
 */

/** Sort orders the read side may ask for. `RELEVANCE` is the engine's own ranking. */
export type SearchIndexSortOption = "RELEVANCE" | "RATING" | "REVIEWS" | "NEWEST" | "DISTANCE";

export interface SearchIndexGeoFilter {
  latitude: number;
  longitude: number;
  /**
   * Optional. When present, documents further away than this (or with no
   * coordinates at all) are excluded. When absent, the point is only a
   * *distance origin* — nothing is filtered out, but `distanceKm` is
   * populated and `sort: "DISTANCE"` becomes meaningful. Separating the
   * two lets "near me" ordering work without forcing an arbitrary radius.
   */
  radiusKm?: number;
}

/**
 * The full query surface of the read model. Every field is optional
 * except pagination — an absent filter matches everything rather than
 * meaning "must be empty", the same convention
 * `ProfessionalSearchFilter` already establishes for the write-model
 * discovery repositories.
 */
export interface SearchIndexQuery {
  /** Free text, matched across `title`/`subtitle`/`text` (multi-field search). */
  text?: string;
  /** Restrict to certain entity kinds. Absent = all kinds. */
  kinds?: SearchDocumentKind[];
  /** Matches a document carrying *any* of these categories. */
  categoryIds?: string[];
  city?: string;
  province?: string;
  verifiedOnly?: boolean;
  minRating?: number;
  minReviewCount?: number;
  near?: SearchIndexGeoFilter;
  sort?: SearchIndexSortOption;
  /**
   * Whether near-miss/typo tolerance is allowed for `text`. Defaults to
   * enabled — every engine behind this port is typo-tolerant by nature,
   * and a customer typing "fontanero" as "fontanro" should still find a
   * plumber. Set `false` for exact-match callers (e.g. an internal
   * consistency check that must not match approximately).
   */
  fuzzy?: boolean;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface SearchIndexHit {
  document: SearchDocument;
  /**
   * The engine's own relevance score, normalized to 0..1 across
   * providers. Never shown to customers (Module 19 already established
   * that numeric scores stay internal); used for ordering, debugging, and
   * tests that assert ranking.
   */
  score: number;
  /** Populated only for a `near` query — great-circle km from the search point. */
  distanceKm: number | null;
}

export interface SearchIndexQueryResult {
  hits: SearchIndexHit[];
  /** Total matching documents *before* pagination. */
  total: number;
  page: number;
  pageSize: number;
  tookMs: number;
}

/**
 * Selects documents for bulk deletion. All present fields are ANDed. An
 * entirely empty filter is legal and means "every document" — used only
 * by operator tooling and tests, never on the normal path.
 */
export interface SearchIndexFilter {
  kind?: SearchDocumentKind;
  entityId?: string;
  /**
   * Deletes documents whose `indexedAt` is strictly older than this
   * ISO-8601 instant. This is what makes a rebuild *safe*: re-index
   * everything first, then sweep whatever the rebuild didn't touch,
   * instead of clearing the index up front and serving empty results
   * until the rebuild finishes.
   */
  indexedBefore?: string;
}

export interface SearchProviderStatus {
  /** `"meilisearch"` | `"typesense"` | `"memory"`. */
  provider: string;
  reachable: boolean;
  /** Total documents currently indexed, when the provider could report it. */
  documentCount: number | null;
  /** Round-trip time of the ping in ms, when measurable. */
  latencyMs: number | null;
  /** Present only when `reachable` is false. */
  error?: string;
}

export interface SearchIndexProvider {
  /** Stable identifier used in health reports and logs. */
  readonly name: string;

  /**
   * Upserts one document, keyed by `document.id`. Idempotent by
   * construction — ids are deterministic (`buildSearchDocumentId`), so
   * indexing the same entity twice overwrites rather than duplicates.
   */
  indexDocument(document: SearchDocument): Promise<void>;

  /**
   * Upserts many documents in one round trip. Same idempotency as
   * `indexDocument`. An empty array is a no-op, never an error — batch
   * callers (rebuild) should not have to guard against an empty page.
   */
  indexDocuments(documents: SearchDocument[]): Promise<void>;

  /** Removes one document by id. A no-op (not an error) if already absent. */
  deleteDocument(documentId: string): Promise<void>;

  /** Removes every document matching `filter`; returns how many were removed. */
  deleteByFilter(filter: SearchIndexFilter): Promise<number>;

  /** Ranked, filtered, paginated query over the read model. */
  search(query: SearchIndexQuery): Promise<SearchIndexQueryResult>;

  /** Indexed document count, optionally for one kind. */
  countDocuments(kind?: SearchDocumentKind): Promise<number>;

  /**
   * Liveness/diagnostics for the health endpoint. **Never throws** — an
   * unreachable engine is reported as `reachable: false` with the error
   * message, because a health check that itself fails is a second
   * incident rather than a signal.
   */
  ping(): Promise<SearchProviderStatus>;
}
