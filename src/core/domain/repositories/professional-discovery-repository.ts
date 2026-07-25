import type { VerificationStatusValue } from "@/domain/repositories/professional-repository";

/**
 * Professional Discovery & Search module.
 *
 * This is a read-only, search-scoped view onto the *existing*
 * ProfessionalProfile/User/Address models — it deliberately does not
 * introduce a new professional or address model. It only exposes the
 * geographic + public-facing fields discovery needs, kept separate from
 * ProfessionalRepository (which is scoped to "a professional managing
 * their own profile") because discovery's access pattern (search-by-
 * category, geo-filter, public read) is a distinct concern with its own
 * trust boundary: nothing here ever accepts or trusts a caller-supplied
 * ownership/status/verification value.
 */

/** A professional profile as a candidate for a discovery search — includes
 *  their own base coordinates and service radius so the use case can apply
 *  the per-professional-radius business rule without a second round trip. */
export interface ProfessionalDiscoveryCandidate {
  id: string;
  displayName: string;
  businessName: string | null;
  headline: string | null;
  yearsExperience: number | null;
  hourlyRate: number | null;
  serviceRadiusKm: number | null;
  verificationStatus: VerificationStatusValue;
  profileImageUrl: string | null;
  categoryIds: string[];
  /** Base location, derived from the professional's own primary address.
   *  Null when the professional has no address with coordinates set yet —
   *  such professionals cannot currently be geo-matched. */
  latitude: number | null;
  longitude: number | null;
  /**
   * Search & Ranking module (Module 19): coarse location (from the same
   * primary address latitude/longitude is derived from), used for city/
   * province matching (@/domain/services/location-match) when precise
   * coordinates or a search radius aren't available/applicable. Added
   * alongside latitude/longitude rather than replacing them — Professional
   * Discovery's existing radius search keeps using coordinates unchanged.
   */
  city: string | null;
  province: string | null;
  /** Search & Ranking module (Module 19): the professional's own
   *  denormalized rating signals (ProfessionalProfile.averageRating /
   *  .reviewCount, maintained by the Reviews & Ratings module) — not
   *  previously exposed here because radius search never needed them. */
  averageRating: number | null;
  reviewCount: number;
  /** Search & Ranking module (Module 19): count of the professional's own
   *  visible portfolio items (not soft-deleted, not admin-moderated) — a
   *  ranking signal, never used to gate discovery eligibility itself. */
  portfolioItemCount: number;
  /** Search & Ranking module (Module 19): used to derive the small
   *  recency ranking signal (@/domain/services/ranking-engine). */
  createdAt: Date;
}

/**
 * Search & Ranking module (Module 19): filters accepted by
 * `searchCandidates`. Every field is optional — an absent filter matches
 * every candidate rather than being treated as "must be empty". Category/
 * verification/rating/review-count/text filtering happens at the database
 * level for performance; ranking itself happens afterwards in the
 * application layer (see SearchDirectoryUseCase), matching the same
 * "candidate retrieval vs. ranking" split `findActiveCandidatesByCategory`
 * already established for radius filtering.
 */
export interface ProfessionalSearchFilter {
  categoryId?: string;
  query?: string;
  city?: string;
  province?: string;
  verifiedOnly?: boolean;
  minRating?: number;
  minReviewCount?: number;
  /**
   * Maps & Geolocation module (Module 20): the effective search point (either
   * client-supplied coordinates or resolved from `city`/`province` by a
   * `GeocodingProvider`) and a search radius, additive alongside every
   * Module 19 field above. When present, the Prisma implementation pushes a
   * cheap bounding-box pre-filter down to SQL (`computeBoundingBox`);
   * `SearchDirectoryUseCase` still re-applies the precise
   * `haversineDistanceKm` cutoff afterwards, since a bounding box is only a
   * superset of the true radius — the exact "cheap DB filter, precise
   * app-layer rule" split `findActiveCandidatesByCategory`'s own radius
   * search already established. Candidates without coordinates are simply
   * excluded from radius filtering (never included, never erroring) — the
   * same fallback behavior `computeCoordinateLocationMatch` already defines
   * for missing coordinates.
   */
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
}

/** Safe, public-facing view of a single professional's profile. Never
 *  includes contact details, tax id, internal moderation fields, or
 *  precise street address — see ProfessionalPublicProfileDto for the
 *  reasoning on each omitted field. */
export interface ProfessionalPublicProfileRecord {
  id: string;
  displayName: string;
  businessName: string | null;
  headline: string | null;
  bio: string | null;
  yearsExperience: number | null;
  hourlyRate: number | null;
  serviceRadiusKm: number | null;
  verificationStatus: VerificationStatusValue;
  profileImageUrl: string | null;
  categoryIds: string[];
  /** Coarse service-area info only (city/province) — never the exact
   *  street address or coordinates of the professional's home/base. */
  city: string | null;
  province: string | null;
}

export interface ProfessionalDiscoveryRepository {
  /**
   * Candidates eligible for discovery for a given service category:
   * ACTIVE professionals only (inactive/suspended professionals and
   * unverified categories are excluded at the query level, never left to
   * the caller to filter). Geographic and radius filtering happen in the
   * application layer (SearchProfessionalsUseCase), not here, so that
   * business rule stays testable independent of Prisma.
   */
  findActiveCandidatesByCategory(categoryId: string): Promise<ProfessionalDiscoveryCandidate[]>;

  /**
   * A single professional as a discovery candidate — the same shape
   * `findActiveCandidatesByCategory` returns, looked up by their own
   * ProfessionalProfile id rather than by category. Added for the
   * Offers/Quotes module (GetAvailableServiceRequestsForProfessionalUseCase /
   * CreateQuoteUseCase), which needs one professional's own base
   * coordinates + serviceRadiusKm + categoryIds to evaluate the "is this
   * request within my radius/category" rule — the exact same fields and
   * ACTIVE-only eligibility this repository already resolves for search, so
   * this reuses that logic rather than duplicating it. Returns null if the
   * professional doesn't exist, is soft-deleted, or is not ACTIVE.
   */
  findCandidateById(professionalId: string): Promise<ProfessionalDiscoveryCandidate | null>;

  /**
   * A single professional's public profile, or null if it doesn't exist,
   * is soft-deleted, or is not ACTIVE. There is deliberately no
   * "findPublicProfileByIdIncludingInactive" — an inactive professional's
   * profile is not publicly viewable, full stop.
   */
  findPublicProfileById(professionalId: string): Promise<ProfessionalPublicProfileRecord | null>;

  /**
   * Search & Ranking module (Module 19): candidates for the unified
   * directory search, filtered at the database level. Same ACTIVE-only,
   * non-deleted eligibility rule as `findActiveCandidatesByCategory` — a
   * suspended/inactive/deleted professional is never returned here either,
   * enforced at the query level rather than left to the caller to filter.
   */
  searchCandidates(filter: ProfessionalSearchFilter): Promise<ProfessionalDiscoveryCandidate[]>;
}
