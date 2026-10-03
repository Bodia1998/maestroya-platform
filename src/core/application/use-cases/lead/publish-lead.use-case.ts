import { NotFoundError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import {
  LeadNotPublishableError,
  assertLeadEligibleFlow,
  assertLeadPublishable,
  assertServiceRequestEligibleForLead,
} from "@/domain/services/lead";

/**
 * Module 124 — publishes a DRAFT Lead (DRAFT -> PUBLISHED, nothing else).
 *
 * `userId` must come from the server-side session; only the owning customer
 * may publish. A Lead that is missing or not yours is the same NotFoundError.
 *
 * Idempotent: publishing an already-PUBLISHED Lead returns it unchanged (no
 * write, no new record). CLOSED / EXPIRED / CANCELLED leads are rejected with
 * LeadNotPublishableError. The flow comes from ServiceRequest.flowVersion
 * (derived onto the LeadRecord), not from duplicated Lead state.
 *
 * Publishing exposes no contact data and creates no financial record: it
 * needs no payment, LeadPurchase, professional or quote. `maxBuyers` is not
 * touched (NULL stays "not configured"). Expiry duration and pricing are
 * future extension points and are intentionally not decided here.
 */
export class PublishLeadUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly leads: LeadRepository,
  ) {}

  async execute(userId: string, leadId: string): Promise<LeadRecord> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) throw new NotFoundError("Lead", leadId);

    const lead = await this.leads.findById(leadId);
    if (!lead) throw new NotFoundError("Lead", leadId);

    const request = await this.serviceRequests.findById(lead.serviceRequestId);
    if (!request || request.customerId !== customer.id) throw new NotFoundError("Lead", leadId);

    assertLeadEligibleFlow(lead.flowVersion);

    if (lead.status === "PUBLISHED") return lead;
    assertLeadPublishable(lead.status);
    assertServiceRequestEligibleForLead(request);

    const published = await this.leads.publish(leadId);
    if (published) return published;

    // Lost a race (or the lead changed after our read): re-read to tell an
    // idempotent repeat from a rejected transition.
    const current = await this.leads.findById(leadId);
    if (!current) throw new NotFoundError("Lead", leadId);
    if (current.status === "PUBLISHED") return current;
    throw new LeadNotPublishableError(current.status);
  }
}
