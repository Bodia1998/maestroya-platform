import { NotFoundError } from "@/domain/errors/domain-error";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestDiscoveryRepository } from "@/domain/repositories/service-request-discovery-repository";
import { distanceToRequestKm, isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";
import type { AvailableServiceRequestSummary } from "@/application/use-cases/quotes/get-available-service-requests-for-professional.use-case";

/**
 * Fetches a single PUBLISHED ServiceRequest for the professional-facing
 * detail page (`/dashboard/professional/requests/[id]`) — but only if the
 * *authenticated* professional is actually eligible to respond to it (see
 * domain/services/quote-eligibility.ts). An ineligible or non-existent
 * request id surfaces as the exact same NotFoundError, so this page can
 * never be used to probe for the existence of requests outside a
 * professional's own category/radius match, mirroring
 * GetServiceRequestUseCase's "not yours vs. doesn't exist" guarantee on the
 * customer side.
 */
export class GetServiceRequestForProfessionalUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly requestDiscovery: ServiceRequestDiscoveryRepository,
  ) {}

  async execute(userId: string, requestId: string): Promise<AvailableServiceRequestSummary> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) throw new NotFoundError("ServiceRequest", requestId);

    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate) throw new NotFoundError("ServiceRequest", requestId);

    const request = await this.requestDiscovery.findPublishedById(requestId);
    if (!request) throw new NotFoundError("ServiceRequest", requestId);
    if (request.customerUserId === userId) throw new NotFoundError("ServiceRequest", requestId);
    if (!isProfessionalEligibleForRequest(candidate, request)) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const distanceKm = distanceToRequestKm(candidate, request);

    return {
      id: request.id,
      title: request.title,
      description: request.description,
      categoryId: request.categoryId,
      categoryName: request.categoryName,
      urgency: request.urgency,
      city: request.city,
      province: request.province,
      distanceKm: distanceKm === null ? 0 : Math.round(distanceKm * 10) / 10,
      createdAt: request.createdAt,
    };
  }
}
