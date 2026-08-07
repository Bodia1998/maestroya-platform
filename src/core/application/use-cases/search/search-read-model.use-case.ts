import type { SearchDocument, SearchDocumentKind } from "@/domain/entities/search-document";
import type {
  SearchIndexProvider,
  SearchIndexQuery,
  SearchIndexSortOption,
} from "@/application/ports/search-index-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";

export interface SearchReadModelQuery {
  query?: string;
  kinds?: SearchDocumentKind[];
  categoryIds?: string[];
  city?: string;
  province?: string;
  verifiedOnly?: boolean;
  minRating?: number;
  minReviewCount?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  sortBy?: SearchIndexSortOption;
  fuzzy?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SearchReadModelItem {
  document: SearchDocument;
  score: number;
  distanceKm: number | null;
}

export interface SearchReadModelResult {
  items: SearchReadModelItem[];
  page: number;
  pageSize: number;
  total: number;
  tookMs: number;
  /**
   * `true` when the search engine could not be reached and this result is
   * an empty placeholder rather than an answer. Callers render "search is
   * temporarily unavailable" instead of "no results found" — the two are
   * very different messages, and conflating them is how a degraded
   * dependency turns into a support ticket about missing professionals.
   */
  degraded: boolean;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The **query side** of CQRS: the read model's entry point. It asks the
 * search engine — never Postgres — for an already-filtered, already-
 * ranked, already-paginated page of documents, and returns them.
 *
 * ## Relationship to Module 19's `SearchDirectoryUseCase`
 * This does not replace it and does not touch it. Module 19 remains the
 * production directory-search pipeline: it queries Postgres through the
 * discovery repositories and ranks candidates in-process with the domain
 * ranking engine, which is correct, strongly consistent, and entirely
 * adequate at the platform's current size. This use case is the same
 * question asked of a different store, with a different set of
 * trade-offs: the work of filtering, scoring, and sorting moves into the
 * engine (so it stays O(1) round trips as the corpus grows and unlocks
 * typo tolerance and autocomplete), at the cost of eventual consistency —
 * a professional edited a moment ago may take a beat to appear. Running
 * both, and cutting pages over deliberately, is the point of keeping them
 * independent.
 *
 * ## Graceful degradation is the whole failure strategy
 * A provider error is caught here and converted into an empty result with
 * `degraded: true`, never rethrown. The reasoning is the same one
 * `/api/health/ready` uses to keep the search engine out of the readiness
 * verdict, and the same one `CacheManager` uses to degrade a cache
 * failure to a miss: the write model is the source of truth and the
 * application is fully functional without search — customers can still
 * browse, quote, book, and pay. Letting an unreachable Meilisearch
 * produce a 500 would convert an optional dependency into a hard one,
 * which is exactly the coupling this architecture exists to avoid.
 */
export class SearchReadModelUseCase {
  constructor(
    private readonly provider: SearchIndexProvider,
    private readonly observer: SearchObserver = nullSearchObserver,
  ) {}

  async execute(input: SearchReadModelQuery = {}): Promise<SearchReadModelResult> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)));

    const query: SearchIndexQuery = {
      text: input.query,
      kinds: input.kinds,
      categoryIds: input.categoryIds,
      city: input.city,
      province: input.province,
      verifiedOnly: input.verifiedOnly,
      minRating: input.minRating,
      minReviewCount: input.minReviewCount,
      // A radius is only meaningful with a centre; a centre without a
      // radius is still useful — it becomes the distance origin for
      // `sort: "DISTANCE"` and for each hit's `distanceKm`, filtering
      // nothing out (see `SearchIndexGeoFilter.radiusKm`).
      near:
        input.latitude !== undefined && input.longitude !== undefined
          ? { latitude: input.latitude, longitude: input.longitude, radiusKm: input.radiusKm }
          : undefined,
      sort: input.sortBy ?? "RELEVANCE",
      fuzzy: input.fuzzy ?? true,
      page,
      pageSize,
    };

    try {
      const result = await this.provider.search(query);
      return {
        items: result.hits.map((hit) => ({
          document: hit.document,
          score: hit.score,
          distanceKm: hit.distanceKm,
        })),
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        tookMs: result.tookMs,
        degraded: false,
      };
    } catch (error) {
      this.observer.onDegraded({ operation: "search", error });
      return { items: [], page, pageSize, total: 0, tookMs: 0, degraded: true };
    }
  }
}
