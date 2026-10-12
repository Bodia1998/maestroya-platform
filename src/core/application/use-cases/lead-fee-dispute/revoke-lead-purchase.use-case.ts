import type { AdminRepository } from "@/domain/repositories/admin-repository";
import type { LeadPurchaseRevocationRepository } from "@/domain/repositories/lead-fee-dispute-repository";
import type { LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import { LeadFeeDisputeRejectedError } from "@/domain/services/lead-fee-dispute";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import { assertLeadFeeDisputeAdminActor } from "@/application/use-cases/lead-fee-dispute/assert-lead-fee-dispute-actor";
import { normalizeAdminText, normalizeEvidenceReference, normalizeId } from "@/application/use-cases/lead-fee-dispute/normalize-lead-fee-dispute-input";

export interface RevokeLeadPurchaseInput {
  /** The administrator. Re-validated here (exists, ACTIVE, ADMIN / SUPER_ADMIN); a caller-supplied claim is never trusted. */
  actorUserId: string;
  leadPurchaseId: string;
  /** Mandatory reason, 1..1000 characters; stored verbatim in the revocation record, never in the audit entry. */
  explanation: string;
  /** Mandatory incident / evidence reference (opaque id). */
  evidenceReference: string;
}

export interface RevokeLeadPurchaseResult {
  leadPurchaseId: string;
  status: LeadPurchaseStatus;
  /** False when the purchase was already REVOKED: nothing was written (idempotent repeat). */
  revoked: boolean;
}

/**
 * Module 155 — administrative revocation of a lead purchase: CONFIRMED -> REVOKED, access withdrawn at once (access is derived
 * from the persisted status on every read). TRUSTED-INTERNAL, like Modules 153/154: nothing calls it before the admin console (M157),
 * and it must never be reachable from the browser; a future caller should still gate with `requireRole`.
 *
 * "Without refund" only. This use case moves no money: no refund, credit note, invoice or ledger entry is created, requested or
 * implied. A revocation "with refund" would have to go through Module 153, whose closed reasons (PLATFORM_ERROR, DUPLICATE_CHARGE)
 * do not include revocation, and whose refunded purchase ends REFUNDED, not REVOKED: that needs an owner decision (D12) and is not
 * guessed here. Only a CONFIRMED purchase can be revoked; a DISPUTED one is decided by its dispute, a REVOKED one is an idempotent no-op.
 * The status change, the revocation record (actor + explanation + evidence reference) and the audit entry are ONE transaction.
 */
export class RevokeLeadPurchaseUseCase {
  constructor(
    private readonly purchases: Pick<LeadPurchaseRepository, "findById">,
    private readonly revocations: LeadPurchaseRevocationRepository,
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: RevokeLeadPurchaseInput): Promise<RevokeLeadPurchaseResult> {
    // 1. Pure validation (no I/O).
    const actorUserId = normalizeId(input?.actorUserId);
    const leadPurchaseId = normalizeId(input?.leadPurchaseId);
    const explanation = normalizeAdminText(input?.explanation);
    const evidenceReference = normalizeEvidenceReference(input?.evidenceReference);

    // 2. The actor is re-read on every call.
    await assertLeadFeeDisputeAdminActor(this.admins, actorUserId);

    // 3. Authoritative purchase state (re-checked again under the row lock by the repository).
    const purchase = await this.purchases.findById(leadPurchaseId);
    if (!purchase) throw new LeadFeeDisputeRejectedError("PURCHASE_NOT_FOUND");
    if (purchase.status !== "CONFIRMED" && purchase.status !== "REVOKED") throw new LeadFeeDisputeRejectedError("PURCHASE_NOT_CONFIRMED");

    const result = await this.revocations.revokeConfirmed({ leadPurchaseId, actorUserId, explanation, evidenceReference, now: this.now() });
    return { leadPurchaseId, status: result.purchaseStatusAfter, revoked: result.revoked };
  }
}
