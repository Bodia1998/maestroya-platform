/**
 * Module 18 — Company Professional: read-only, search-scoped view onto
 * CompanyProfile for the Professional Discovery module — the company-side
 * mirror of ProfessionalDiscoveryRepository. Deliberately its own interface
 * (not a union/merge into ProfessionalDiscoveryRepository) so a customer
 * search can compose "professional candidates" + "company candidates" at the
 * use-case level without either repository knowing the other exists — same
 * "search's own trust boundary" reasoning ProfessionalDiscoveryRepository's
 * own doc comment gives.
 */

/** A company as a discovery search candidate. No latitude/longitude-based
 *  radius matching yet — CompanyProfile has no per-company service radius
 *  field (Module 20 — Maps/Geolocation is the natural home for that); city/
 *  province substring matching is the interim mechanism, same limitation
 *  ProfessionalDiscoveryCandidate has for professionals with no address. */
export interface CompanyDiscoveryCandidate {
  id: string;
  displayName: string;
  legalName: string;
  description: string | null;
  logoUrl: string | null;
  isVerified: boolean;
  averageRating: number | null;
  reviewCount: number;
  categoryIds: string[];
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Count of currently active (joined, not removed) members — shown on the
   *  public profile as "team size", never the members' identities. */
  teamSize: number;
  /** Search & Ranking module (Module 19): count of the company's own
   *  visible portfolio items — a ranking signal, never a discovery gate. */
  portfolioItemCount: number;
  /** Search & Ranking module (Module 19): used to derive the small
   *  recency ranking signal (@/domain/services/ranking-engine). */
  createdAt: Date;
}

/** Search & Ranking module (Module 19): see
 *  ProfessionalSearchFilter's own doc comment — same shape and semantics,
 *  the company-side mirror. */
export interface CompanySearchFilter {
  categoryId?: string;
  query?: string;
  city?: string;
  province?: string;
  verifiedOnly?: boolean;
  minRating?: number;
  minReviewCount?: number;
}

/** Safe, public-facing view of a single company's profile. Never includes
 *  contact details, tax id, internal member list, verification documents,
 *  or Stripe account id. */
export interface CompanyPublicProfileRecord {
  id: string;
  slug: string | null;
  displayName: string;
  legalName: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  isVerified: boolean;
  averageRating: number | null;
  reviewCount: number;
  categoryIds: string[];
  city: string | null;
  province: string | null;
  teamSize: number;
}

export interface CompanyDiscoveryRepository {
  /** ACTIVE companies only (mirrors ProfessionalDiscoveryRepository's own
   *  ACTIVE-only filtering, using CompanyStatus.ACTIVE + isCompanyDiscoverable
   *  instead of ProfessionalStatus.ACTIVE). */
  findActiveCandidatesByCategory(categoryId: string): Promise<CompanyDiscoveryCandidate[]>;
  findCandidateById(companyId: string): Promise<CompanyDiscoveryCandidate | null>;
  findPublicProfileById(companyId: string): Promise<CompanyPublicProfileRecord | null>;
  findPublicProfileBySlug(slug: string): Promise<CompanyPublicProfileRecord | null>;

  /** Search & Ranking module (Module 19): see
   *  ProfessionalDiscoveryRepository.searchCandidates's own doc comment —
   *  same ACTIVE-only eligibility rule, the company-side mirror. */
  searchCandidates(filter: CompanySearchFilter): Promise<CompanyDiscoveryCandidate[]>;
}
