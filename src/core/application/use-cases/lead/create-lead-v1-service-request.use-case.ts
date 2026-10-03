import { ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type { LeadRecord } from "@/domain/repositories/lead-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { ServiceRequestRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import type { CreateServiceRequestInput } from "@/application/dto/service-request.dto";
import type { CreateLeadUseCase } from "@/application/use-cases/lead/create-lead.use-case";

export interface CreateLeadV1ServiceRequestResult {
  serviceRequest: ServiceRequestRecord;
  lead: LeadRecord;
}

/**
 * Module 125 — the explicit Lead Marketplace entry: creates a
 * `flowVersion = LEAD_V1` ServiceRequest for the authenticated customer and,
 * through Module 124's CreateLeadUseCase, its single DRAFT Lead.
 *
 * Deliberately a separate use case from the legacy CreateServiceRequestUseCase
 * (which is untouched and always yields LEGACY_QUOTE_PAYMENT): the flow is
 * the literal `LEAD_FLOW_VERSION` below, never derived from input. The input
 * schema (createServiceRequestSchema) strips unknown keys, so a client-sent
 * `flowVersion`, `customerId` or `userId` never reaches this class; and even
 * a hostile caller passing them on the object is ignored because only the
 * named fields are copied.
 *
 * `userId` must come from the server-side session. Ownership is derived from
 * it (CustomerProfile resolved/created lazily, exactly like the legacy path).
 *
 * It is financially inert: it writes a ServiceRequest (+ its Address) and a
 * DRAFT Lead only — no Quote, Payment, Commission, Payout, Invoice,
 * LeadPurchase or affiliate record, and no pricing. Publication is a separate
 * explicit step (PublishLeadUseCase).
 *
 * Consistency: the project has no cross-repository transaction abstraction
 * (ServiceRequest/Address creation is already two writes in the legacy path),
 * and Lead creation must not be re-implemented here. If Lead creation fails,
 * the just-created request is compensated to CANCELLED (an existing status
 * write) so no open LEAD_V1 request is left without its Lead, and the
 * original error is rethrown. LEAD_V1 requests never reach the legacy feed
 * in any case. The user-visible failure is "creation failed", never partial.
 */
export class CreateLeadV1ServiceRequestUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly categories: ServiceCategoryRepository,
    private readonly geocoding: GeocodingProvider,
    private readonly createLead: Pick<CreateLeadUseCase, "execute">,
  ) {}

  async execute(userId: string, input: CreateServiceRequestInput): Promise<CreateLeadV1ServiceRequestResult> {
    if (input.budgetMin !== undefined && input.budgetMax !== undefined && input.budgetMin > input.budgetMax) {
      throw new ValidationError("Minimum budget must not exceed maximum budget.");
    }

    const [category] = await this.categories.findActiveByIds([input.categoryId]);
    if (!category) {
      throw new ValidationError("Selected service category is invalid or inactive.");
    }

    const customer = await this.customerProfiles.findOrCreateByUserId(userId);

    // Same coordinate rule as the legacy path: explicit client coordinates
    // win, otherwise best-effort geocoding of city/province (never fails the
    // creation; it only affects discoverability).
    let latitude = input.location.latitude ?? null;
    let longitude = input.location.longitude ?? null;
    if (latitude === null || longitude === null) {
      const point = await this.geocoding.geocode({
        city: input.location.city,
        province: input.location.province || undefined,
        country: input.location.country || undefined,
      });
      latitude = latitude ?? point?.latitude ?? null;
      longitude = longitude ?? point?.longitude ?? null;
    }

    const serviceRequest = await this.serviceRequests.create(customer.id, userId, {
      categoryId: category.id,
      title: input.title,
      description: input.description,
      urgency: input.urgency ?? "MEDIUM",
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null,
      location: {
        line1: input.location.line1,
        line2: input.location.line2 || null,
        city: input.location.city,
        province: input.location.province || null,
        postalCode: input.location.postalCode,
        country: input.location.country,
        latitude,
        longitude,
      },
      flowVersion: LEAD_FLOW_VERSION,
    });

    try {
      const lead = await this.createLead.execute(userId, serviceRequest.id);
      return { serviceRequest, lead };
    } catch (error) {
      await this.serviceRequests.updateStatus(serviceRequest.id, "CANCELLED").catch(() => undefined);
      throw error;
    }
  }
}
