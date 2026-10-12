import type { LeadContactSharingRepository } from "@/domain/repositories/lead-privacy-repository";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import { decideContactSharing, type LeadPrivacyPolicy } from "@/domain/services/lead-privacy";

/**
 * Module 158 — purchase-initiation guard. A buyer must not be charged for access whose contact the M138 gate would then always deny.
 * Uses the SAME decision as the contact readers (`decideContactSharing`), so the two cannot drift.
 *
 * - Undecided policy (D19 not made): always allowed and NO read is made, so behaviour is exactly as before M158.
 * - CONSENT: a lead without a recorded, non-withdrawn consent is not purchasable. Existing leads are NOT backfilled, so under
 *   CONSENT they stay unpurchasable until their customer gives consent — by design (no silent consent).
 * - OTHER_LAWFUL_BASIS: allowed unless a (consent) record was withdrawn.
 * A read failure propagates (fail closed). Callers map `false` to the uniform `LeadNotPurchasableError`.
 */
export class LeadContactSharingPurchaseGate {
  constructor(
    private readonly sharing: Pick<LeadContactSharingRepository, "findByLeadId">,
    private readonly policy: Pick<LeadPrivacyPolicy, "contactSharingBasis">,
  ) {}

  async allowsPurchase(leadId: string): Promise<boolean> {
    if (this.policy.contactSharingBasis === null) return true;
    const record = await this.sharing.findByLeadId(leadId);
    return decideContactSharing(this.policy, record).allowed;
  }
}

/**
 * Decorator applied in the composition root (the use case itself, and its pinned constructor shape, are untouched). Runs BEFORE the
 * inner use case so an open PENDING_PAYMENT retry is gated too. A denial is the uniform `LeadNotPurchasableError`; a malformed id is
 * passed through so the inner use case rejects it exactly as before.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function guardLeadPurchaseByContactSharing<R>(
  inner: { execute(userId: string, leadId: string): Promise<R> },
  gate: Pick<LeadContactSharingPurchaseGate, "allowsPurchase">,
): { execute(userId: string, leadId: string): Promise<R> } {
  return {
    async execute(userId, leadId) {
      if (typeof leadId === "string" && UUID.test(leadId) && !(await gate.allowsPurchase(leadId))) throw new LeadNotPurchasableError();
      return inner.execute(userId, leadId);
    },
  };
}
