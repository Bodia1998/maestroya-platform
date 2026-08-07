/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The **read model**: the denormalized shape a single searchable entity
 * takes *inside the search index*, as opposed to `search-result.ts`'s
 * `SearchResult`, which is the shape Module 19's Postgres-backed
 * `SearchDirectoryUseCase` returns to a page.
 *
 * The two are deliberately separate types rather than one shared one,
 * even though they overlap heavily:
 *
 *  - `SearchResult` is a *query response* — it carries `rankingReasons`
 *    computed per-request by the domain ranking engine and a privacy-fuzzed
 *    `mapPoint`, neither of which is a property of the entity itself.
 *  - `SearchDocument` is a *stored projection* — everything a search
 *    engine needs to filter, sort, and rank **without a second lookup**:
 *    the text it matches on, the category ids/city/province/coordinates it
 *    filters on, and the rating/review/recency signals it sorts on. Its
 *    fields are chosen so that filtering and sorting happen inside the
 *    engine rather than in application code after retrieval, which is the
 *    entire performance argument for having a search engine at all.
 *
 * It is a plain, JSON-safe record (ISO-8601 strings, no `Date`, no
 * behaviour) for the same reason `StoredJob` is (Module 45): it
 * round-trips through JSON into Meilisearch/Typesense and back, and must
 * survive that trip without a custom (de)serializer.
 *
 * Everything here is **public-safe**. A document is what an anonymous
 * visitor could already see on a public profile page — never contact
 * details, tax ids, verification case history, or precise home
 * coordinates. The write model (Prisma/Postgres) remains the only source
 * of truth; a document is a derived, disposable copy that can always be
 * rebuilt from it (see `RebuildSearchIndexUseCase`).
 */

/**
 * The entity kinds projected into the read model. Professionals and
 * companies mirror `SearchResultKind` (the two things customer-facing
 * directory search returns); `SERVICE_REQUEST` is the professional-facing
 * side of discovery ("open jobs I could quote on"), which has no
 * Postgres-backed search pipeline today and exists here because the
 * search index is the natural home for it.
 */
export type SearchDocumentKind = "PROFESSIONAL" | "COMPANY" | "SERVICE_REQUEST";

export const SEARCH_DOCUMENT_KINDS: readonly SearchDocumentKind[] = [
  "PROFESSIONAL",
  "COMPANY",
  "SERVICE_REQUEST",
];

export interface SearchDocument {
  /**
   * The index's primary key — always `buildSearchDocumentId(kind, entityId)`,
   * never a random id. Determinism is what makes indexing **idempotent**:
   * re-indexing the same entity overwrites exactly one document instead of
   * accumulating duplicates, so a job delivered twice (an at-least-once
   * queue always eventually will) is harmless by construction rather than
   * by a de-duplication check.
   */
  id: string;
  kind: SearchDocumentKind;
  /** The write model's own id for this entity (ProfessionalProfile.id, ...). */
  entityId: string;

  /** Primary display/matching field — a professional's display name, a request's title. */
  title: string;
  /** Secondary display/matching field — a business/legal name. `null` when absent. */
  subtitle: string | null;
  /**
   * The free-text blob multi-field full-text search matches against
   * (headline + bio + description + city, ...). Denormalized at index
   * time so a text query never needs a join or a second read.
   */
  text: string;

  categoryIds: string[];
  city: string | null;
  province: string | null;
  /**
   * Coarse coordinates for geo filtering *inside the engine*. Populated
   * from the same primary-address coordinates Module 19's discovery
   * repositories already expose. Never rendered directly — a UI still
   * fuzzes coordinates for display (`domain/services/coordinate-fuzzing`).
   */
  latitude: number | null;
  longitude: number | null;

  isVerified: boolean;
  averageRating: number | null;
  reviewCount: number;
  portfolioItemCount: number;

  /** Entity creation time (ISO-8601) — the recency ranking/sorting signal. */
  createdAt: string;
  /**
   * When this *projection* was written (ISO-8601). Distinct from
   * `createdAt`, and the mechanism behind safe rebuilds: a rebuild
   * re-indexes everything with a fresh `indexedAt`, then deletes whatever
   * still carries an older one (see `SearchIndexFilter.indexedBefore`).
   * That ordering means the index is never emptied first, so search keeps
   * serving results throughout a rebuild.
   */
  indexedAt: string;
}

/**
 * The one place a document id is assembled. Kind-prefixed so three
 * entity kinds can share a single index without a professional and a
 * service request that happen to share a UUID colliding, and so
 * `deleteByFilter({ kind })` has a cheap, obvious meaning.
 */
export function buildSearchDocumentId(kind: SearchDocumentKind, entityId: string): string {
  return `${kind.toLowerCase()}:${entityId}`;
}
