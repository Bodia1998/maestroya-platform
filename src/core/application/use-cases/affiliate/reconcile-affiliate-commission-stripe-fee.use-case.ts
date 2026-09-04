import { calculateAffiliateCommissionFeeCorrection } from "@/domain/services/affiliate-commission-policy";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { AffiliateCommissionReversalRepository } from "@/domain/repositories/affiliate-commission-reversal-repository";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import type { FinancialLedgerRepository } from "@/domain/repositories/financial-ledger-repository";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 96 Financial Fix Pass — Stripe fee-timing reconciliation.
 *
 * Closes the gap `RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber.
 * resolveStripeFee`'s own doc comment already names honestly: a commission
 * created before the real Stripe fee arrived is created with
 * `attributableCostAmount = 0`, and nothing previously ever revisited it
 * once the fee showed up. This use case is that revisit — reusing the
 * SAME append-only `AffiliateCommissionReversalRepository` ledger the
 * refund/dispute reversal path already writes to (see
 * `ReverseAffiliateCommissionUseCase`), never a second accounting model.
 *
 * ## Two callers, one idempotent effect
 * Called from two places, both safe to call repeatedly and safe to call
 * for a commission that turns out not to need correction:
 *  1. `handleAffiliateFeeCapturedForPayment` (payments webhook route) —
 *     immediately after a `STRIPE_FEE` ledger row is written, the common-
 *     case path where the fee simply arrives after the commission (no
 *     genuine race).
 *  2. `RunReferralAffiliateMaintenanceSweepUseCase`'s cron sweep — a
 *     backstop for the narrow true-race window where the fee webhook and
 *     the commission-creation subscriber are in flight at the same
 *     instant and each misses the other's not-yet-committed write. Since
 *     this use case is idempotent, the sweep re-attempting it daily for
 *     every zero-cost commission is harmless, not merely tolerated.
 *
 * ## Idempotency
 * Keyed on a deterministic `financialAdjustmentId = "stripe-fee-
 * correction:<affiliateCommissionId>"` — at most one correction is ever
 * recorded per commission, enforced by
 * `AffiliateCommissionReversalRepository`'s existing DB-level unique
 * constraint on that column (never only an application-level check), the
 * same authoritative-uniqueness convention this repository already
 * documents for refund/dispute reversals.
 *
 * ## Never mutates the original snapshot
 * `AffiliateCommission.platformCommissionAmount` / `attributableCostAmount`
 * / `profitBaseAmount` / `affiliateAmount` are never written to by this
 * use case — exactly like a refund reversal, the correction lives
 * entirely in the reversal ledger's `reversedAmount` delta and the
 * commission's own `reversedAmount` running total. A `PAID` commission
 * stays `PAID` (the money already left the platform); the reversal row is
 * the durable record of what MaestroYa now owes back against a future
 * payout/reconciliation — identical to `ReverseAffiliateCommissionUseCase`'s
 * own "already PAID stays PAID" rule.
 */
export class ReconcileAffiliateCommissionStripeFeeUseCase {
  constructor(
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly reversals: AffiliateCommissionReversalRepository,
    private readonly financialLedger: FinancialLedgerRepository,
    /** Module 22's own Commission repository — used only to resolve
     *  `platformCommissionRefId` (a Commission.id) back to the
     *  `paymentId` its STRIPE_FEE ledger row is keyed on. Read-only,
     *  never written to (see `affiliate-commission-repository.ts`'s own
     *  doc comment on this module never owning Module 22 data). */
    private readonly commissions: CommissionRepository,
  ) {}

  /**
   * `platformCommissionRefId` is the ONLY required input — this use case
   * resolves the affected payment's id itself (via `commissions`), so
   * both callers (the payments-webhook route, which only ever knows a
   * `paymentId`, and the maintenance-sweep backstop, which only ever
   * knows an `AffiliateCommission` row and therefore its
   * `platformCommissionRefId`) can call this the same way.
   */
  async execute(input: { platformCommissionRefId: string }): Promise<AffiliateCommissionRecord | null> {
    const commission = await this.affiliateCommissions.findByPlatformCommissionRefId(input.platformCommissionRefId);
    if (!commission) {
      // No affiliate was ever attributed to this payment — nothing to
      // reconcile, identical in meaning to every other "no affiliate
      // applies" case elsewhere in this module.
      return null;
    }

    if (commission.attributableCostAmount > 0) {
      // The real fee was already known at commission-creation time (the
      // overwhelmingly common case — Stripe's `charge.updated` normally
      // arrives well before `PaymentReleaseApproved`) — nothing to
      // correct. This is a cheap short-circuit, not the authoritative
      // idempotency guarantee (that's the reversal-ledger lookup below).
      return commission;
    }

    if (commission.status === "CANCELLED" || commission.status === "EXPIRED" || commission.status === "REVERSED") {
      // Never payable, or already fully reversed by something else —
      // nothing left to correct.
      return commission;
    }

    const financialAdjustmentId = `stripe-fee-correction:${commission.id}`;
    const existingReversal = await this.reversals.findByFinancialAdjustmentId(financialAdjustmentId);
    if (existingReversal) {
      // Already reconciled — whether by an earlier call from the webhook
      // path or a prior sweep run. Idempotent no-op.
      return commission;
    }

    const platformCommission = await this.commissions.findById(input.platformCommissionRefId);
    if (!platformCommission) {
      // Should not happen (platformCommissionRefId always came from an
      // already-created Commission) — nothing to key the ledger lookup
      // on if it somehow did.
      return commission;
    }

    const entries = await this.financialLedger.listForPayment(platformCommission.paymentId);
    const feeEntry = entries.find((entry) => entry.type === "STRIPE_FEE");
    if (!feeEntry) {
      // Fee genuinely still not captured yet — nothing to do. The
      // caller (webhook path or sweep) will get another chance later;
      // see this class's own doc comment on why repeated no-op calls are
      // safe and expected, not a bug.
      return commission;
    }

    const actualFee = Math.abs(feeEntry.amount);
    if (actualFee <= 0) {
      // A genuine zero-fee payment — cost=0 was correct all along, no
      // correction needed, no reversal recorded.
      return commission;
    }

    // Module 96 Financial Integrity Hardening Pass: the correction amount
    // AND the row's mutation are both decided/applied atomically inside
    // `applyReversalAtomically`'s own row lock — never from this
    // pre-lock `commission` read, which can be stale under concurrency
    // if a refund/dispute reversal for the SAME commission lands at the
    // same instant (see that method's own doc comment).
    const updated = await this.affiliateCommissions.applyReversalAtomically(
      commission.id,
      financialAdjustmentId,
      (current) => {
        const correction = calculateAffiliateCommissionFeeCorrection({
          platformCommissionAmount: commission.platformCommissionAmount,
          affiliateAmount: current.affiliateAmount,
          actualAttributableCostAmount: actualFee,
          alreadyReversedAmount: current.reversedAmount,
          rateBps: commission.affiliateRateBps,
        });
        if (correction.reversalAmount <= 0) {
          return null;
        }
        return {
          amount: correction.reversalAmount,
          reason:
            `Stripe processing fee of ${actualFee.toFixed(2)} captured after this commission was created with ` +
            `attributableCostAmount=0 — corrects the profit base from ${commission.platformCommissionAmount.toFixed(2)} to ` +
            `${correction.correctedProfitBaseAmount.toFixed(2)} and the affiliate amount from ${commission.affiliateAmount.toFixed(2)} to ` +
            `${correction.correctedAffiliateAmount.toFixed(2)}.`,
        };
      },
    );

    if (updated) {
      logger.info("affiliate.commission.stripe_fee_reconciled", {
        affiliateCommissionId: commission.id,
        paymentId: platformCommission.paymentId,
        actualFee,
        reversalAmount: updated.reversedAmount - commission.reversedAmount,
      });
    }

    return updated ?? commission;
  }
}
