import type { RequestUrgencyValue } from "@/domain/repositories/service-request-repository";

/**
 * Offers/Quotes module: read-only, professional-facing discovery view onto
 * the *existing* ServiceRequest/Address/CustomerProfile models — mirrors the
 * same pattern as professional-discovery-repository.ts (a distinct,
 * search-scoped repository rather than reusing ServiceRequestRepository,
 * which is scoped to "a customer managing their own requests" and has its
 * own trust boundary). Nothing here ever accepts or trusts a caller-supplied
 * ownership/status value.
 *
 * Geographic + category-radius filtering happen in the application layer
 * (GetAvailableServiceRequestsForProfessionalUseCase / CreateQuoteUseCase),
 * not here, reusing `haversineDistanceKm`/`isWithinServiceRadius` from
 * geo-distance.ts — same reasoning as SearchProfessionalsUseCase applying
 * that rule against ProfessionalDiscoveryRepository's raw candidates.
 */
export interface ServiceRequestDiscoveryCandidate {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  urgency: RequestUrgencyValue;
  /** Coarse location only — city/province, never the exact street address.
   *  See CustomerProfile/Address ownership note on ServiceRequestRepository. */
  city: string;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The User behind the owning CustomerProfile — needed only so
   *  CreateQuoteUseCase/GetAvailableServiceRequestsForProfessionalUseCase can
   *  enforce "a professional cannot quote their own request" when the same
   *  person holds both a CustomerProfile and a ProfessionalProfile. Never
   *  exposed in any professional-facing DTO. */
  customerUserId: string;
  createdAt: Date;
}

export interface ServiceRequestDiscoveryRepository {
  /**
   * A single PUBLISHED ServiceRequest as a quoting candidate, or null if it
   * doesn't exist, is soft-deleted, or is not PUBLISHED. There is
   * deliberately no "findByIdIncludingUnpublished" — a non-PUBLISHED
   * request is not quotable, full stop, mirroring
   * ProfessionalDiscoveryRepository.findPublicProfileById's "not publicly
   * visible, full stop" convention for inactive professionals.
   */
  findPublishedById(id: string): Promise<ServiceRequestDiscoveryCandidate | null>;

  /**
   * All PUBLISHED ServiceRequests across the given category ids — the
   * professional's own configured service categories. Only PUBLISHED
   * requests are ever returned at the query level, never left to the
   * caller to filter.
   */
  findPublishedByCategoryIds(categoryIds: string[]): Promise<ServiceRequestDiscoveryCandidate[]>;
}
