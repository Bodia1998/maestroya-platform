import type { SearchDocument, SearchDocumentKind } from "@/domain/entities/search-document";
import { haversineDistanceKm } from "@/domain/services/geo-distance";
import type {
  SearchIndexFilter,
  SearchIndexHit,
  SearchIndexProvider,
  SearchIndexQuery,
  SearchIndexQueryResult,
  SearchProviderStatus,
} from "@/application/ports/search-index-provider";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * A complete, working `SearchIndexProvider` over a process-local `Map` —
 * the search analogue of `InMemoryCacheProvider` (Module 46) and
 * `InMemoryJobStore` (Module 45), and the default in every environment
 * that has no Meilisearch/Typesense configured (which is local
 * development, CI, and this repository's entire test suite).
 *
 * It is emphatically **not** a no-op stub. It implements the same
 * filtering, geo, ranking, sorting, pagination, and typo-tolerance
 * semantics the real engines do, using plain array operations. Three
 * things follow from that, all of them the point:
 *
 *  1. The read model is fully exercisable — and the whole CQRS pipeline
 *     end-to-end testable — with no external infrastructure. Every
 *     behavioural test in this module runs against this class, which is
 *     only sound because it is a real implementation of the contract
 *     rather than a mock of it.
 *  2. "Graceful degradation" is testable: a test can wrap or replace this
 *     with a throwing provider and assert the application keeps serving.
 *  3. `SEARCH_PROVIDER=none` (the default) is a *functional* mode, not a
 *     disabled one. A developer running the app locally gets working
 *     search, per-process and non-persistent, instead of a silently empty
 *     results page.
 *
 * What it deliberately does not attempt: persistence, cross-process
 * sharing, stemming/lemmatisation, or synonym expansion. Those are the
 * reasons to run a real engine in production, and pretending to provide
 * them here would make this class a worse test double, not a better one.
 */

/** Field weights for multi-field matching — a name match beats a bio match. */
const FIELD_WEIGHTS = { title: 3, subtitle: 2, text: 1 } as const;
const MAX_FIELD_WEIGHT = FIELD_WEIGHTS.title;

/** Ranking weights. Sum to 1, so a `RELEVANCE` score is always 0..1. */
const RANKING_WEIGHTS = {
  text: 0.55,
  verified: 0.15,
  rating: 0.15,
  reviews: 0.1,
  recency: 0.05,
} as const;

/** Reviews saturate: the 1st review matters far more than the 101st. */
const REVIEW_SATURATION = 50;
/** A document loses its recency bonus linearly over this window. */
const RECENCY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Lowercases and strips diacritics so "Fontanería Gómez" is found by
 * "fontaneria gomez". Non-negotiable for a Spanish-market platform, and
 * the same normalization both real engines apply by default — matching it
 * here is what keeps test expectations valid against production.
 */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Classic iterative Levenshtein with a cutoff. Bounded work per pair
 * (`|a| * |b|`, both short — these are words), and the cutoff lets the
 * caller stop caring about distances it would reject anyway.
 */
function levenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      // Every index below is provably within bounds (`current` has `j`
      // entries by this point and `previous` has `b.length + 1`), which
      // `noUncheckedIndexedAccess` cannot see — hence the assertions.
      const value = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }

  return previous[b.length]!;
}

/**
 * Typo tolerance calibrated to Meilisearch's own default ladder: no
 * tolerance for very short words (where one edit changes the word
 * entirely — "casa"/"cosa"), one edit from 5 characters, two from 9.
 * Matching a real engine's thresholds means a query behaves the same in
 * tests as in production.
 */
function maxTypos(token: string): number {
  if (token.length >= 9) return 2;
  if (token.length >= 5) return 1;
  return 0;
}

/**
 * How well one query token matches one field's tokens, 0..1. Exact beats
 * prefix beats fuzzy — the ordering that makes an exact-name search rank
 * the exact name first even when a dozen near-misses also match.
 */
function tokenMatchQuality(queryToken: string, fieldTokens: string[], fuzzy: boolean): number {
  let best = 0;

  for (const fieldToken of fieldTokens) {
    if (fieldToken === queryToken) return 1;
    if (fieldToken.startsWith(queryToken)) {
      best = Math.max(best, 0.8);
      continue;
    }
    if (fuzzy) {
      const allowed = maxTypos(queryToken);
      if (allowed > 0 && levenshtein(queryToken, fieldToken, allowed) <= allowed) {
        best = Math.max(best, 0.6);
      }
    }
  }

  return best;
}

interface IndexedFields {
  title: string[];
  subtitle: string[];
  text: string[];
}

function fieldsOf(document: SearchDocument): IndexedFields {
  return {
    title: tokenize(document.title),
    subtitle: document.subtitle ? tokenize(document.subtitle) : [],
    text: tokenize(document.text),
  };
}

/**
 * Multi-field relevance for a whole query, 0..1, or `null` when the
 * document does not match at all.
 *
 * AND semantics across tokens (every query token must match *some*
 * field): "fontanero madrid" must not return every plumber in Spain
 * merely because one token matched. Within a token, the best-weighted
 * field wins, so matching a name counts for more than matching a bio.
 */
function relevanceOf(queryTokens: string[], fields: IndexedFields, fuzzy: boolean): number | null {
  let total = 0;

  for (const queryToken of queryTokens) {
    const weighted = Math.max(
      tokenMatchQuality(queryToken, fields.title, fuzzy) * FIELD_WEIGHTS.title,
      tokenMatchQuality(queryToken, fields.subtitle, fuzzy) * FIELD_WEIGHTS.subtitle,
      tokenMatchQuality(queryToken, fields.text, fuzzy) * FIELD_WEIGHTS.text,
    );
    if (weighted === 0) return null;
    total += weighted;
  }

  return total / (queryTokens.length * MAX_FIELD_WEIGHT);
}

function containsFold(haystack: string | null, needle: string): boolean {
  if (!haystack) return false;
  return normalize(haystack).includes(normalize(needle));
}

export class InMemorySearchProvider implements SearchIndexProvider {
  readonly name = "memory";

  private readonly documents = new Map<string, SearchDocument>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async indexDocument(document: SearchDocument): Promise<void> {
    // Stored as a copy: the caller keeps ownership of its object, and a
    // later mutation of it must not retroactively change the index — the
    // same value semantics a real engine has by virtue of serializing.
    this.documents.set(document.id, { ...document, categoryIds: [...document.categoryIds] });
  }

  async indexDocuments(documents: SearchDocument[]): Promise<void> {
    for (const document of documents) await this.indexDocument(document);
  }

  async deleteDocument(documentId: string): Promise<void> {
    this.documents.delete(documentId);
  }

  async deleteByFilter(filter: SearchIndexFilter): Promise<number> {
    let removed = 0;
    for (const [id, document] of this.documents) {
      if (!matchesFilter(document, filter)) continue;
      this.documents.delete(id);
      removed += 1;
    }
    return removed;
  }

  async countDocuments(kind?: SearchDocumentKind): Promise<number> {
    if (!kind) return this.documents.size;
    let count = 0;
    for (const document of this.documents.values()) if (document.kind === kind) count += 1;
    return count;
  }

  async ping(): Promise<SearchProviderStatus> {
    return {
      provider: this.name,
      reachable: true,
      documentCount: this.documents.size,
      latencyMs: 0,
    };
  }

  async search(query: SearchIndexQuery): Promise<SearchIndexQueryResult> {
    const startedAt = this.now();
    const fuzzy = query.fuzzy ?? true;
    const queryTokens = query.text ? tokenize(query.text) : [];

    const scored: (SearchIndexHit & { createdAtMs: number })[] = [];

    for (const document of this.documents.values()) {
      if (!passesFilters(document, query)) continue;

      const distanceKm = distanceFor(document, query);
      if (query.near?.radiusKm !== undefined && (distanceKm === null || distanceKm > query.near.radiusKm)) {
        continue;
      }

      let relevance = 0;
      if (queryTokens.length > 0) {
        const matched = relevanceOf(queryTokens, fieldsOf(document), fuzzy);
        if (matched === null) continue;
        relevance = matched;
      }

      scored.push({
        document,
        score: this.rank(document, relevance),
        distanceKm,
        createdAtMs: Date.parse(document.createdAt),
      });
    }

    sortHits(scored, query.sort ?? "RELEVANCE");

    const page = Math.max(1, query.page);
    const pageSize = Math.max(1, query.pageSize);
    const start = (page - 1) * pageSize;

    return {
      hits: scored.slice(start, start + pageSize).map(({ document, score, distanceKm }) => ({
        document,
        score,
        distanceKm,
      })),
      total: scored.length,
      page,
      pageSize,
      tookMs: Math.max(0, this.now() - startedAt),
    };
  }

  /** Test/operator affordance, outside the port — wipes the whole index. */
  clear(): void {
    this.documents.clear();
  }

  /**
   * Blends text relevance with the same quality signals Module 19's
   * domain ranking engine uses (verification, rating, review volume,
   * recency), on the same reasoning: the best match for "plumber in
   * Madrid" is not merely the one whose text matched hardest, it is a
   * good, verified, well-reviewed plumber in Madrid. Weights live in one
   * constant so the trade-off is visible and tunable rather than buried
   * in an expression.
   */
  private rank(document: SearchDocument, relevance: number): number {
    const rating = document.averageRating === null ? 0 : Math.min(1, Math.max(0, document.averageRating / 5));
    const reviews = Math.min(1, document.reviewCount / REVIEW_SATURATION);
    const ageMs = Math.max(0, this.now() - Date.parse(document.createdAt));
    const recency = Math.max(0, 1 - ageMs / RECENCY_WINDOW_MS);

    return (
      RANKING_WEIGHTS.text * relevance +
      RANKING_WEIGHTS.verified * (document.isVerified ? 1 : 0) +
      RANKING_WEIGHTS.rating * rating +
      RANKING_WEIGHTS.reviews * reviews +
      RANKING_WEIGHTS.recency * recency
    );
  }
}

function matchesFilter(document: SearchDocument, filter: SearchIndexFilter): boolean {
  if (filter.kind && document.kind !== filter.kind) return false;
  if (filter.entityId && document.entityId !== filter.entityId) return false;
  if (filter.indexedBefore && !(Date.parse(document.indexedAt) < Date.parse(filter.indexedBefore))) return false;
  return true;
}

function passesFilters(document: SearchDocument, query: SearchIndexQuery): boolean {
  if (query.kinds && query.kinds.length > 0 && !query.kinds.includes(document.kind)) return false;
  if (query.categoryIds && query.categoryIds.length > 0) {
    if (!query.categoryIds.some((categoryId) => document.categoryIds.includes(categoryId))) return false;
  }
  if (query.city && !containsFold(document.city, query.city)) return false;
  if (query.province && !containsFold(document.province, query.province)) return false;
  if (query.verifiedOnly && !document.isVerified) return false;
  if (query.minRating !== undefined && (document.averageRating ?? 0) < query.minRating) return false;
  if (query.minReviewCount !== undefined && document.reviewCount < query.minReviewCount) return false;
  return true;
}

function distanceFor(document: SearchDocument, query: SearchIndexQuery): number | null {
  if (!query.near) return null;
  if (document.latitude === null || document.longitude === null) return null;
  return haversineDistanceKm(
    { latitude: query.near.latitude, longitude: query.near.longitude },
    { latitude: document.latitude, longitude: document.longitude },
  );
}

/**
 * Sorting is total and deterministic: every branch falls through to the
 * same tie-break chain (score desc, reviews desc, createdAt asc, id asc),
 * so equal-scoring documents never come back in `Map` insertion order.
 * That is the same guarantee Module 19's `sortResults` makes, and it is
 * what allows pagination to be correct at all — a non-deterministic order
 * would let one document appear on both page 1 and page 2.
 */
function sortHits(hits: (SearchIndexHit & { createdAtMs: number })[], sort: string): void {
  hits.sort((a, b) => {
    const primary = comparePrimary(a, b, sort);
    if (primary !== 0) return primary;
    if (b.score !== a.score) return b.score - a.score;
    if (b.document.reviewCount !== a.document.reviewCount) {
      return b.document.reviewCount - a.document.reviewCount;
    }
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    return a.document.id.localeCompare(b.document.id);
  });
}

function comparePrimary(
  a: SearchIndexHit & { createdAtMs: number },
  b: SearchIndexHit & { createdAtMs: number },
  sort: string,
): number {
  switch (sort) {
    case "RATING":
      return (b.document.averageRating ?? 0) - (a.document.averageRating ?? 0);
    case "REVIEWS":
      return b.document.reviewCount - a.document.reviewCount;
    case "NEWEST":
      return b.createdAtMs - a.createdAtMs;
    case "DISTANCE": {
      // Documents with no coordinates sort last rather than first — an
      // unknown location is not "at distance 0".
      const left = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const right = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (left === right) return 0;
      return left - right;
    }
    case "RELEVANCE":
    default:
      return b.score - a.score;
  }
}
