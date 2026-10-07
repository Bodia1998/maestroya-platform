import type { LeadPurchaseDTO } from "@/application/dto/lead-purchase.dto";
import { toLeadPurchaseDto } from "@/application/dto/lead-purchase.dto";
import { ProfessionalNotVerifiedError } from "@/domain/errors/domain-error";
import type { LeadPreviewRepository } from "@/domain/repositories/lead-preview-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { LEAD_FLOW_VERSION, assertServiceRequestEligibleForLead } from "@/domain/services/lead";
import {
  DuplicateActiveLeadPurchaseError,
  LeadNotPurchasableError,
  isProfessionalEligibleToPurchaseLeads,
} from "@/domain/services/lead-purchase";
import { isLeadMarketplaceReady } from "@/domain/services/lead-publication";
import { isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 126/135 — a professional starts buying access to a published Lead.
 * Result: a LeadPurchase in PENDING_PAYMENT. That grants NO contact access
 * (Module 122 only honours CONFIRMED) and takes no payment.
 *
 * Trust boundary: `userId` is the server-side session user; the professional
 * profile is resolved from it. The only client value is `leadId`. There is NO
 * price input and NO pricing provider: the fee is the Lead's immutable M133
 * publication snapshot, copied by `purchases.initiate` under the lead row lock
 * (Module 135). It is never recomputed from mutable pricing configuration.
 *
 * Order: input -> professional (ACTIVE + VERIFIED) -> lead (exists, LEAD_V1,
 * PUBLISHED) -> request (still open) -> isLeadMarketplaceReady (M134: complete
 * M133 snapshot) -> the same visibility/eligibility the Module 124 preview
 * applies -> idempotent replay -> atomic create.
 *
 * Every "you may not buy this" outcome (missing, legacy, unpublished, not
 * marketplace-ready, closed, expired, cancelled, request closed, not eligible,
 * own lead) is the SAME LeadNotPurchasableError: no existence/ownership
 * probing, no customer data. Buyer-limit and duplicate errors are only
 * reachable by an eligible buyer.
 *
 * Idempotency (Module 135): the invariant is "at most one ACTIVE
 * (PENDING_PAYMENT or CONFIRMED) purchase per (lead, professional)"; terminal
 * rows are history and a new attempt after FAILED/CANCELLED is a new row. A
 * repeated/duplicate/concurrent initiation while the purchase is still
 * PENDING_PAYMENT returns THAT purchase (same id, same snapshot) instead of an
 * error or a second row. An already CONFIRMED purchase is still
 * DuplicateActiveLeadPurchaseError (it is bought; there is nothing to retry).
 *
 * Concurrency: `purchases.initiate` locks the lead row, re-checks the
 * duplicate and maxBuyers and inserts in one transaction; the partial unique
 * index `lead_purchases_one_active_per_lead_professional` remains the final
 * arbiter. The use case additionally replays on a lost race.
 *
 * Out of scope here: payment provider, tax policy (M136), contact, customer payments.
 */
export class InitiateLeadPurchaseUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly leads: LeadRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly leadPreviews: LeadPreviewRepository,
    private readonly purchases: LeadPurchaseRepository,
  ) {}

  async execute(userId: string, leadId: string): Promise<LeadPurchaseDTO> {
    if (typeof userId !== "string" || userId === "" || typeof leadId !== "string" || !UUID.test(leadId)) {
      throw new LeadNotPurchasableError();
    }

    const professional = await this.professionals.findByUserId(userId);
    if (!professional) throw new LeadNotPurchasableError();
    if (!isProfessionalEligibleToPurchaseLeads(professional)) {
      if (professional.status === "ACTIVE") {
        throw new ProfessionalNotVerifiedError("Your professional profile must be verified before you can purchase leads.");
      }
      throw new LeadNotPurchasableError();
    }

    const lead = await this.leads.findById(leadId);
    if (!lead || lead.flowVersion !== LEAD_FLOW_VERSION || lead.status !== "PUBLISHED") throw new LeadNotPurchasableError();

    const request = await this.serviceRequests.findById(lead.serviceRequestId);
    if (!request) throw new LeadNotPurchasableError();
    try {
      assertServiceRequestEligibleForLead(request);
    } catch {
      throw new LeadNotPurchasableError();
    }
    // Module 134 boundary: only a lead the Lead Feed v2 would list may be bought. A
    // PUBLISHED LEAD_V1 lead without a complete Module 133 publication snapshot (e.g.
    // published by Module 124 before M133) is not marketplace-ready. Same authoritative
    // policy as the feed (M130 availability + complete snapshot); not a new rule.
    if (!isLeadMarketplaceReady({ leadStatus: lead.status, flowVersion: lead.flowVersion, requestStatus: request.status, publication: lead.publication })) {
      throw new LeadNotPurchasableError();
    }

    // Same visibility as the preview: published + LEAD_V1 + open + not deleted.
    const visible = await this.leadPreviews.findPublishedById(leadId);
    if (!visible || visible.customerUserId === userId) throw new LeadNotPurchasableError();
    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate || !isProfessionalEligibleForRequest(candidate, visible)) throw new LeadNotPurchasableError();

    // Early idempotent answer. The DB partial unique index (and the locked re-check) is final.
    const existing = await this.purchases.findActiveByLeadAndProfessional(leadId, professional.id);
    if (existing) return this.replayOrReject(existing);

    try {
      const purchase = await this.purchases.initiate({ leadId, professionalProfileId: professional.id });
      return toLeadPurchaseDto(purchase);
    } catch (error) {
      // Lost a race against an identical request: use the purchase that won.
      if (error instanceof DuplicateActiveLeadPurchaseError) {
        const winner = await this.purchases.findActiveByLeadAndProfessional(leadId, professional.id);
        if (winner) return this.replayOrReject(winner);
      }
      throw error;
    }
  }

  /** PENDING_PAYMENT = the same attempt is still open -> return it unchanged. Anything else active (CONFIRMED) is a duplicate. */
  private replayOrReject(existing: LeadPurchaseRecord): LeadPurchaseDTO {
    if (existing.status === "PENDING_PAYMENT") return toLeadPurchaseDto(existing);
    throw new DuplicateActiveLeadPurchaseError();
  }
}
