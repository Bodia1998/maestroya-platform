import { NotFoundError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { LeadAlreadyExistsError, assertLeadEligibleFlow, assertServiceRequestEligibleForLead } from "@/domain/services/lead";
import type { TransactionFlowReader } from "@/application/ports/transaction-flow-reader";

/**
 * Module 124 — creates the (single) DRAFT Lead for a LEAD_V1 ServiceRequest.
 *
 * `userId` must come from the server-side session. Only the owning customer
 * may create the Lead; a request that is missing or not yours is the same
 * NotFoundError (no probing).
 *
 * Order: ownership -> flow (LEAD_V1 only; ServiceRequest.flowVersion is the
 * source of truth) -> request state -> existing-Lead check -> create. The
 * `leads.serviceRequestId` UNIQUE constraint stays authoritative: a
 * concurrent create loses with LeadAlreadyExistsError from the repository.
 *
 * Creates ONLY a Lead row (status DRAFT, maxBuyers left NULL = policy not
 * configured). No publication, LeadPurchase, Payment, Quote, Commission,
 * Payout, Invoice or affiliate record, and no pricing: a future Pricing
 * Engine plugs in here (extension point), nothing is calculated now.
 */
export class CreateLeadUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly flows: TransactionFlowReader,
    private readonly leads: LeadRepository,
  ) {}

  async execute(userId: string, serviceRequestId: string): Promise<LeadRecord> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) throw new NotFoundError("ServiceRequest", serviceRequestId);

    const request = await this.serviceRequests.findById(serviceRequestId);
    if (!request || request.customerId !== customer.id) throw new NotFoundError("ServiceRequest", serviceRequestId);

    const flow = await this.flows.findFlowVersion(serviceRequestId);
    if (flow === null) throw new NotFoundError("ServiceRequest", serviceRequestId);
    assertLeadEligibleFlow(flow);

    assertServiceRequestEligibleForLead(request);

    if (await this.leads.findByServiceRequestId(serviceRequestId)) {
      throw new LeadAlreadyExistsError(serviceRequestId);
    }

    return this.leads.create({ serviceRequestId });
  }
}
