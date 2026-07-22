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
   * A single professional's public profile, or null if it doesn't exist,
   * is soft-deleted, or is not ACTIVE. There is deliberately no
   * "findPublicProfileByIdIncludingInactive" — an inactive professional's
   * profile is not publicly viewable, full stop.
   */
  findPublicProfileById(professionalId: string): Promise<ProfessionalPublicProfileRecord | null>;
}
