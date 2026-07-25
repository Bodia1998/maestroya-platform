import { ValidationError } from "@/domain/errors/domain-error";
import { computeLocationMatch, computeCoordinateLocationMatch } from "@/domain/services/location-match";
import { computeProfileCompleteness } from "@/domain/services/profile-completeness";
import { computeTextRelevance } from "@/domain/services/text-relevance";
import { scoreCandidate, type RankingScore } from "@/domain/services/ranking-engine";
import { haversineDistanceKm, type GeoPoint } from "@/domain/services/geo-distance";
import { fuzzCoordinate } from "@/domain/services/coordinate-fuzzing";
import type { GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type {
  ProfessionalDiscoveryCandidate,
  ProfessionalDiscoveryRepository,
} from "@/domain/repositories/professional-discovery-repository";
import type {
  CompanyDiscoveryCandidate,
  CompanyDiscoveryRepository,
} from "@/domain/repositories/company-discovery-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { ProfessionalSearchResult, CompanySearchResult, SearchResult } from "@/domain/entities/search-result";
import type { SearchDirectoryInput } from "@/application/dto/search.dto";

export interface SearchDirectoryResult {
  items: SearchResult[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Search & Ranking module (Module 19) — unified professional + company
 * directory search.
 *
 * Pipeline (see docs/MODULE_19_SEARCH_RANKING.md, "Search Flow"):
 *
 *   1. Candidate retrieval  — ProfessionalDiscoveryRepository.searchCandidates
 *                             / CompanyDiscoveryRepository.searchCandidates
 *                             push category/verification/rating/review-count/
 *                             city/province/text filters to the database.
 *   2. Filtering            — already applied at retrieval; nothing further
 *                             is filtered out here (a candidate that comes
 *                             back from step 1 is always eligible).
 *   3. Ranking              — each candidate's signals are computed here and
 *                             scored by the pure domain ranking engine.
 *   4. Ranking explanation  — scoreCandidate returns customer-safe reasons,
 *                             attached to each result.
 *   5. Sorting              — by the requested SearchSortOption, with a
 *                             fully deterministic tie-break so equal scores
 *                             never depend on retrieval/insertion order.
 *   6. Pagination           — offset-based (page/pageSize), matching the
 *                             convention SearchProfessionalsUseCase already
 *                             established — not cursor-based, since that is
 *                             not this project's existing pattern anywhere.
 *   7. Unified result       — professionals and companies interleaved into
 *                             one SearchResult[] rather than two separate
 *                             lists, per Module 19's "unified search"
 *                             requirement (distinct from the existing
 *                             per-category SearchProfessionalsUseCase /
 *                             SearchCompaniesUseCase, which this module does
 *                             not replace — see the module doc's
 *                             "Relationship to Professional Discovery").
 *
 * Trust boundary: the only inputs accepted from the client are query text,
 * category, city/province, verifiedOnly, minRating, minReviewCount, sortBy,
 * and pagination (all validated by searchDirectorySchema). Professional/
 * company status, verification status, and discovery eligibility are never
 * client-controlled — they come entirely from the discovery repositories,
 * which only ever return ACTIVE, non-deleted candidates.
 */
export class SearchDirectoryUseCase {
  constructor(
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly companyDiscovery: CompanyDiscoveryRepository,
    private readonly categories: ServiceCategoryRepository,
    /** Injected for deterministic, testable recency scoring — defaults to
     *  the real clock in production via the composition root. */
    private readonly now: () => Date = () => new Date(),
    /**
     * Maps & Geolocation module (Module 20): optional — when the client
     * search didn't supply explicit `latitude`/`longitude` but did supply a
     * `city`, this resolves an approximate search point so
     * `computeCoordinateLocationMatch` (Module 19, unused by any caller
     * until now) and radius filtering can both work from a plain city name.
     * Defaults to `undefined` so every existing caller/test that doesn't
     * pass one keeps working identically to before this module — geocoding
     * is a pure enhancement, never a requirement.
     */
    private readonly geocoding?: GeocodingProvider,
  ) {}

  async execute(input: SearchDirectoryInput): Promise<SearchDirectoryResult> {
    if (input.categoryId) {
      const [category] = await this.categories.findActiveByIds([input.categoryId]);
      if (!category) {
        throw new ValidationError("Select a valid, active service category.");
      }
    }

    const searchPoint = await this.resolveSearchPoint(input);

    const filter = {
      categoryId: input.categoryId,
      query: input.query,
      city: input.city,
      province: input.province,
      verifiedOnly: input.verifiedOnly,
      minRating: input.minRating,
      minReviewCount: input.minReviewCount,
      latitude: searchPoint?.latitude,
      longitude: searchPoint?.longitude,
      radiusKm: input.radiusKm,
    };

    const [professionalCandidates, companyCandidates] = await Promise.all([
      this.professionalDiscovery.searchCandidates(filter),
      this.companyDiscovery.searchCandidates(filter),
    ]);

    // Maps & Geolocation module (Module 20): the repository's bounding-box
    // pre-filter is only a superset of the true circle (see
    // `computeBoundingBox`'s own doc comment) — re-apply the precise
    // Haversine cutoff here so a corner-of-the-box false positive never
    // reaches the customer. Candidates without coordinates are excluded
    // from a radius search entirely (never included, never an error).
    const professionals =
      searchPoint && input.radiusKm !== undefined
        ? professionalCandidates.filter((c) => withinRadius(searchPoint, c, input.radiusKm!))
        : professionalCandidates;
    const companies =
      searchPoint && input.radiusKm !== undefined
        ? companyCandidates.filter((c) => withinRadius(searchPoint, c, input.radiusKm!))
        : companyCandidates;

    const now = this.now();

    const professionalResults = professionals.map((candidate) =>
      this.rankProfessional(candidate, input, now, searchPoint),
    );
    const companyResults = companies.map((candidate) => this.rankCompany(candidate, input, now, searchPoint));

    const scored: { result: SearchResult; score: RankingScore; createdAt: Date }[] = [
      ...professionalResults,
      ...companyResults,
    ];

    const sorted = sortResults(scored, input.sortBy);

    const page = input.page;
    const pageSize = input.pageSize;
    const start = (page - 1) * pageSize;
    const paged = sorted.slice(start, start + pageSize).map((entry) => entry.result);

    return { items: paged, page, pageSize, total: sorted.length };
  }

  /**
   * Maps & Geolocation module (Module 20): resolves the effective search
   * point for this request. Client-supplied `latitude`/`longitude` always
   * wins (it's the most precise signal available); otherwise, when a `city`
   * was given and a `GeocodingProvider` is configured, attempts to resolve
   * one from the city name. Returns `undefined` when neither is available —
   * every downstream coordinate-based feature (bounding-box filtering,
   * radius cutoff, `computeCoordinateLocationMatch`) simply falls back to
   * its pre-Module-20 behavior in that case.
   */
  private async resolveSearchPoint(input: SearchDirectoryInput): Promise<GeoPoint | undefined> {
    if (input.latitude !== undefined && input.longitude !== undefined) {
      return { latitude: input.latitude, longitude: input.longitude };
    }
    if (input.city && this.geocoding) {
      const resolved = await this.geocoding.geocode({ city: input.city, province: input.province });
      return resolved ?? undefined;
    }
    return undefined;
  }

  private locationMatchFor(
    input: SearchDirectoryInput,
    candidate: { city: string | null; province: string | null; latitude: number | null; longitude: number | null },
    searchPoint: GeoPoint | undefined,
  ) {
    const candidatePoint =
      candidate.latitude !== null && candidate.longitude !== null
        ? { latitude: candidate.latitude, longitude: candidate.longitude }
        : null;
    const coordinateMatch = computeCoordinateLocationMatch(searchPoint ?? null, candidatePoint);

    // When both the search point and candidate coordinates are available,
    // coordinate proximity is the authoritative location signal.
    // If coordinates are unavailable, fall back to the existing city/province match.
    if (coordinateMatch) return coordinateMatch;

    if (searchPoint && candidatePoint) {
      return "NONE";
    }

    return computeLocationMatch(
      { city: input.city, province: input.province },
      { city: candidate.city, province: candidate.province },
    );
  }

  private mapPointFor(candidate: { latitude: number | null; longitude: number | null }) {
    if (candidate.latitude === null || candidate.longitude === null) return null;
    return fuzzCoordinate({ latitude: candidate.latitude, longitude: candidate.longitude });
  }

  private rankProfessional(
    candidate: ProfessionalDiscoveryCandidate,
    input: SearchDirectoryInput,
    now: Date,
    searchPoint: GeoPoint | undefined,
  ): { result: SearchResult; score: RankingScore; createdAt: Date } {
    const isVerified = candidate.verificationStatus === "VERIFIED";
    const textRelevance = computeTextRelevance(input.query, [
      candidate.displayName,
      candidate.businessName,
      candidate.headline,
    ]);
    const locationMatch = this.locationMatchFor(input, candidate, searchPoint);
    const profileCompleteness = computeProfileCompleteness({
      hasHeadlineOrDescription: Boolean(candidate.headline),
      hasBioOrDescription: Boolean(candidate.headline),
      hasCategories: candidate.categoryIds.length > 0,
      hasLocation: Boolean(candidate.city),
      hasAvatarOrLogo: Boolean(candidate.profileImageUrl),
      hasContactInfo: Boolean(candidate.businessName),
      hasPortfolio: candidate.portfolioItemCount > 0,
    });

    const score = scoreCandidate({
      categoryMatch: !input.categoryId || candidate.categoryIds.includes(input.categoryId),
      textRelevance,
      locationMatch,
      isVerified,
      averageRating: candidate.averageRating,
      reviewCount: candidate.reviewCount,
      portfolioItemCount: candidate.portfolioItemCount,
      profileCompleteness,
      createdAt: candidate.createdAt,
      now,
    });

    const result: ProfessionalSearchResult = {
      kind: "PROFESSIONAL",
      id: candidate.id,
      displayName: candidate.displayName,
      businessName: candidate.businessName,
      headline: candidate.headline,
      yearsExperience: candidate.yearsExperience,
      hourlyRate: candidate.hourlyRate,
      categoryIds: candidate.categoryIds,
      city: candidate.city,
      province: candidate.province,
      profileImageUrl: candidate.profileImageUrl,
      isVerified,
      averageRating: candidate.averageRating,
      reviewCount: candidate.reviewCount,
      portfolioItemCount: candidate.portfolioItemCount,
      rankingReasons: score.reasons,
      mapPoint: this.mapPointFor(candidate),
    };

    return { result, score, createdAt: candidate.createdAt };
  }

  private rankCompany(
    candidate: CompanyDiscoveryCandidate,
    input: SearchDirectoryInput,
    now: Date,
    searchPoint: GeoPoint | undefined,
  ): { result: SearchResult; score: RankingScore; createdAt: Date } {
    const textRelevance = computeTextRelevance(input.query, [
      candidate.displayName,
      candidate.legalName,
      candidate.description,
    ]);
    const locationMatch = this.locationMatchFor(input, candidate, searchPoint);
    const profileCompleteness = computeProfileCompleteness({
      hasHeadlineOrDescription: Boolean(candidate.description),
      hasBioOrDescription: Boolean(candidate.description),
      hasCategories: candidate.categoryIds.length > 0,
      hasLocation: Boolean(candidate.city),
      hasAvatarOrLogo: Boolean(candidate.logoUrl),
      hasContactInfo: true,
      hasPortfolio: candidate.portfolioItemCount > 0,
    });

    const score = scoreCandidate({
      categoryMatch: !input.categoryId || candidate.categoryIds.includes(input.categoryId),
      textRelevance,
      locationMatch,
      isVerified: candidate.isVerified,
      averageRating: candidate.averageRating,
      reviewCount: candidate.reviewCount,
      portfolioItemCount: candidate.portfolioItemCount,
      profileCompleteness,
      createdAt: candidate.createdAt,
      now,
    });

    const result: CompanySearchResult = {
      kind: "COMPANY",
      id: candidate.id,
      displayName: candidate.displayName,
      legalName: candidate.legalName,
      description: candidate.description,
      teamSize: candidate.teamSize,
      categoryIds: candidate.categoryIds,
      city: candidate.city,
      province: candidate.province,
      profileImageUrl: candidate.logoUrl,
      isVerified: candidate.isVerified,
      averageRating: candidate.averageRating,
      reviewCount: candidate.reviewCount,
      portfolioItemCount: candidate.portfolioItemCount,
      rankingReasons: score.reasons,
      mapPoint: this.mapPointFor(candidate),
    };

    return { result, score, createdAt: candidate.createdAt };
  }
}

/**
 * Deterministic ordering for every SearchSortOption. Every branch ends in
 * the same final tie-break chain (score desc, review count desc, createdAt
 * asc, id asc) so that when the primary sort key is itself equal, the
 * result order never depends on retrieval/insertion order — required for
 * "ranking does not depend on object insertion order" and "equal scores
 * have stable tie-breaking" (Module 19 testing requirements).
 */
function sortResults(
  entries: { result: SearchResult; score: RankingScore; createdAt: Date }[],
  sortBy: SearchDirectoryInput["sortBy"],
): { result: SearchResult; score: RankingScore; createdAt: Date }[] {
  const withIndex = entries.map((entry, index) => ({ entry, index }));

  withIndex.sort((a, b) => {
    const primary = comparePrimary(a.entry, b.entry, sortBy);
    if (primary !== 0) return primary;
    return tieBreak(a.entry, b.entry);
  });

  return withIndex.map((wrapped) => wrapped.entry);
}

function comparePrimary(
  a: { result: SearchResult; score: RankingScore },
  b: { result: SearchResult; score: RankingScore },
  sortBy: SearchDirectoryInput["sortBy"],
): number {
  switch (sortBy) {
    case "RATING":
      return (b.result.averageRating ?? 0) - (a.result.averageRating ?? 0);
    case "REVIEWS":
      return b.result.reviewCount - a.result.reviewCount;
    case "NEWEST":
      return 0; // resolved by createdAt in the tie-break below
    case "VERIFIED":
      return Number(b.result.isVerified) - Number(a.result.isVerified);
    case "RELEVANCE":
    default:
      return b.score.total - a.score.total;
  }
}

/**
 * Maps & Geolocation module (Module 20): precise radius cutoff applied
 * after the repository's approximate bounding-box pre-filter. A candidate
 * with no coordinates never matches a radius search — there's nothing to
 * measure a distance to, so it's excluded rather than assumed to be either
 * in or out of range.
 */
function withinRadius(
  searchPoint: GeoPoint,
  candidate: { latitude: number | null; longitude: number | null },
  radiusKm: number,
): boolean {
  if (candidate.latitude === null || candidate.longitude === null) return false;
  return haversineDistanceKm(searchPoint, { latitude: candidate.latitude, longitude: candidate.longitude }) <= radiusKm;
}

function tieBreak(
  a: { result: SearchResult; score: RankingScore; createdAt: Date },
  b: { result: SearchResult; score: RankingScore; createdAt: Date },
): number {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;
  if (b.result.reviewCount !== a.result.reviewCount) return b.result.reviewCount - a.result.reviewCount;
  if (b.createdAt.getTime() !== a.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
  return a.result.id.localeCompare(b.result.id);
}
