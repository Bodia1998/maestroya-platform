import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { RequestUrgencyValue } from "@/domain/repositories/service-request-repository";
import type { ServiceRequestDiscoveryRepository } from "@/domain/repositories/service-request-discovery-repository";
import { distanceToRequestKm, isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";

export interface AvailableServiceRequestSummary {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  urgency: RequestUrgencyValue;
  city: string;
  province: string | null;
  distanceKm: number;
  createdAt: Date;
}

/**
 * Lists PUBLISHED ServiceRequests the *authenticated* professional is
 * eligible to respond to — the professional-facing equivalent of
 * SearchProfessionalsUseCase, but from the other side of the marketplace.
 *
 * `userId` must come from the server-side session, never a client-supplied
 * professionalId — this use case has no id parameter to trust or distrust,
 * mirroring GetCustomerServiceRequestsUseCase's guarantee.
 *
 * A signed-in user with no ProfessionalProfile, an inactive one, no
 * configured categories, or no configured radius/coordinates simply gets an
 * empty list — same "not an error, just nothing to show" convention as
 * GetProfessionalByUserIdUseCase returning null.
 *
 * Never exposes the customer's exact address — only city/province (see
 * ServiceRequestDiscoveryRepository's doc comment).
 */
export class GetAvailableServiceRequestsForProfessionalUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly requestDiscovery: ServiceRequestDiscoveryRepository,
  ) {}

  async execute(userId: string): Promise<AvailableServiceRequestSummary[]> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) return [];

    // Re-resolved via the discovery repository (not just `professional`
    // above) so this use case enforces the exact same ACTIVE-only
    // eligibility, and gets the same base-location fields, that
    // SearchProfessionalsUseCase already relies on for the mirror-image
    // rule — one definition of "is this professional eligible", not two.
    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate) return [];
    if (candidate.categoryIds.length === 0) return [];

    const requests = await this.requestDiscovery.findPublishedByCategoryIds(candidate.categoryIds);

    const results: AvailableServiceRequestSummary[] = [];
    for (const request of requests) {
      // A professional can never quote (or see, here) their own request —
      // relevant when the same person holds both a CustomerProfile and a
      // ProfessionalProfile.
      if (request.customerUserId === userId) continue;
      if (!isProfessionalEligibleForRequest(candidate, request)) continue;

      const distanceKm = distanceToRequestKm(candidate, request);
      if (distanceKm === null) continue;

      results.push({
        id: request.id,
        title: request.title,
        description: request.description,
        categoryId: request.categoryId,
        categoryName: request.categoryName,
        urgency: request.urgency,
        city: request.city,
        province: request.province,
        distanceKm: Math.round(distanceKm * 10) / 10,
        createdAt: request.createdAt,
      });
    }

    results.sort((a, b) => a.distanceKm - b.distanceKm);
    return results;
  }
}
