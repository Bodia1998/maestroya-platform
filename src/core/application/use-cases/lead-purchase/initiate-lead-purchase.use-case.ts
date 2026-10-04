import type { LeadPurchaseDTO } from "@/application/dto/lead-purchase.dto";
import { toLeadPurchaseDto } from "@/application/dto/lead-purchase.dto";
import type { LeadPurchasePriceProvider } from "@/application/ports/lead-purchase-price-provider";
import { ProfessionalNotVerifiedError } from "@/domain/errors/domain-error";
import type { LeadPreviewRepository } from "@/domain/repositories/lead-preview-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { LEAD_FLOW_VERSION, assertServiceRequestEligibleForLead } from "@/domain/services/lead";
import {
  DuplicateActiveLeadPurchaseError,
  LeadNotPurchasableError,
  LeadPurchasePricingError,
  assertValidLeadPurchaseAmount,
  isProfessionalEligibleToPurchaseLeads,
} from "@/domain/services/lead-purchase";
import { isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 126 — a professional starts buying access to a published Lead.
 * Result: a LeadPurchase in PENDING_PAYMENT. That grants NO contact access
 * (Module 122 only honours CONFIRMED) and takes no payment.
 *
 * Trust boundary: `userId` is the server-side session user; the professional
 * profile is resolved from it. The only client value is `leadId`. The price
 * comes from the server-side LeadPurchasePriceProvider, never the client.
 *
 * Order: input -> professional (ACTIVE + VERIFIED) -> lead (exists, LEAD_V1,
 * PUBLISHED) -> request (still open) -> the same visibility/eligibility the
 * Module 124 preview applies (published+open+LEAD_V1 query, category, radius,
 * never your own request) -> duplicate -> price -> atomic create.
 *
 * Every "you may not buy this" outcome (missing, legacy, unpublished, closed,
 * expired, cancelled, request closed, not eligible, own lead) is the SAME
 * LeadNotPurchasableError: no existence/ownership probing, no customer data.
 * Buyer-limit and duplicate errors are only reachable by an eligible buyer.
 *
 * Concurrency: `purchases.initiate` locks the lead row, checks maxBuyers and
 * inserts in one transaction; the partial unique index
 * `lead_purchases_one_active_per_lead_professional` remains the final
 * arbiter for the same professional.
 *
 * Pricing failures surface as LeadPurchasePricingError (nothing persisted).
 *
 * Out of scope here: payment provider, pricing rules, contact, customer payments.
 */
export class InitiateLeadPurchaseUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly leads: LeadRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly leadPreviews: LeadPreviewRepository,
    private readonly purchases: LeadPurchaseRepository,
    private readonly prices: LeadPurchasePriceProvider,
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

    // Same visibility as the preview: published + LEAD_V1 + open + not deleted.
    const visible = await this.leadPreviews.findPublishedById(leadId);
    if (!visible || visible.customerUserId === userId) throw new LeadNotPurchasableError();
    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate || !isProfessionalEligibleForRequest(candidate, visible)) throw new LeadNotPurchasableError();

    // Early, friendly duplicate answer. The DB partial unique index is final.
    const existing = await this.purchases.findActiveByLeadAndProfessional(leadId, professional.id);
    if (existing) {
      throw new DuplicateActiveLeadPurchaseError();
    }

    const { price, currency } = await this.resolvePrice(leadId);
    const purchase = await this.purchases.initiate({ leadId, professionalProfileId: professional.id, price, currency });
    return toLeadPurchaseDto(purchase);
  }

  /** Price failure (provider throws, or returns an unusable amount) is one
   *  typed error; nothing has been written at this point. */
  private async resolvePrice(leadId: string): Promise<{ price: number; currency: string }> {
    try {
      const quote = await this.prices.getPriceForLead(leadId);
      assertValidLeadPurchaseAmount(quote.price, quote.currency);
      return { price: quote.price, currency: quote.currency };
    } catch {
      throw new LeadPurchasePricingError();
    }
  }
}
