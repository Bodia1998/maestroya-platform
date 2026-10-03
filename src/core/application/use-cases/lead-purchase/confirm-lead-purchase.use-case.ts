import type { LeadPurchaseDTO } from "@/application/dto/lead-purchase.dto";
import { toLeadPurchaseDto } from "@/application/dto/lead-purchase.dto";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { LEAD_FLOW_VERSION, assertServiceRequestEligibleForLead } from "@/domain/services/lead";
import { InvalidLeadPurchaseTransitionError, LeadNotPurchasableError, assertLeadPurchaseTransition } from "@/domain/services/lead-purchase";

/**
 * Module 126 — TRUSTED, INTERNAL boundary where a (future) payment provider
 * integration reports "the professional paid": PENDING_PAYMENT -> CONFIRMED.
 *
 * SECURITY: this class takes NO user/session and NO client-supplied status
 * or "paid" flag, and is deliberately NOT exposed by any Server Action,
 * route or API. A browser user can never mark their own purchase as paid.
 * The future webhook/payment adapter (which must verify the provider's
 * signature) is the only intended caller.
 *
 * Idempotent: confirming an already CONFIRMED purchase returns it unchanged
 * (no write, `confirmedAt` untouched). The write is a status-conditional
 * update, so concurrent confirmations transition exactly once; a terminal
 * purchase (FAILED/CANCELLED/REFUNDED/REVOKED) can never become CONFIRMED.
 *
 * Confirming still requires the Lead to be a PUBLISHED LEAD_V1 lead whose
 * request is still open. If it no longer is, the purchase is NOT confirmed
 * (the payment side must then cancel/refund — future module).
 * Confirming grants no contact itself; Module 122's policy decides access.
 */
export class ConfirmLeadPurchaseUseCase {
  constructor(
    private readonly purchases: LeadPurchaseRepository,
    private readonly leads: LeadRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(purchaseId: string): Promise<LeadPurchaseDTO> {
    const purchase = await this.purchases.findById(purchaseId);
    if (!purchase) throw new NotFoundError("LeadPurchase", String(purchaseId));

    if (purchase.status === "CONFIRMED") return toLeadPurchaseDto(purchase);
    assertLeadPurchaseTransition(purchase.status, "CONFIRMED");

    const lead = await this.leads.findById(purchase.leadId);
    if (!lead || lead.flowVersion !== LEAD_FLOW_VERSION || lead.status !== "PUBLISHED") throw new LeadNotPurchasableError();
    const request = await this.serviceRequests.findById(lead.serviceRequestId);
    if (!request) throw new LeadNotPurchasableError();
    try {
      assertServiceRequestEligibleForLead(request);
    } catch {
      throw new LeadNotPurchasableError();
    }

    const confirmed = await this.purchases.transition(purchaseId, "PENDING_PAYMENT", "CONFIRMED", this.now());
    if (confirmed) return toLeadPurchaseDto(confirmed);

    // Lost a race (or changed after our read): idempotent repeat vs rejection.
    const current = await this.purchases.findById(purchaseId);
    if (!current) throw new NotFoundError("LeadPurchase", purchaseId);
    if (current.status === "CONFIRMED") return toLeadPurchaseDto(current);
    throw new InvalidLeadPurchaseTransitionError(current.status, "CONFIRMED");
  }
}
