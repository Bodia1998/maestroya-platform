import { calculateAffiliateCommissionReversal } from "@/domain/services/affiliate-commission-policy";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { AffiliateCommissionReversalRepository } from "@/domain/repositories/affiliate-commission-reversal-repository";
import { logger } from "@/infrastructure/observability/logger";

export interface ReverseAffiliateCommissionInput {
  affiliateCommissionId: string;
  /** Module 77 `FinancialAdjustment.id` this reversal is derived from —
   *  never a caller-generated id, always the real, already-`APPLIED`
   *  refund/dispute-loss adjustment. The idempotency anchor — see
   *  `AffiliateCommissionReversalRepository`'s own doc comment. */
  financialAdjustmentId: string;
  refundedAmount: number;
  paymentAmount: number;
  isFullRefund: boolean;
  reason: string | null;
}

/**
 * Module 96 — Referral & Affiliate Production Wiring.
 *
 * The affiliate-side mirror of Module 77's refund execution: given a
 * refund/dispute-loss already decided and applied elsewhere (this use
 * case never decides whether a refund is owed, only reacts to one that
 * already happened), reverses the corresponding portion of an
 * already-recorded `AffiliateCommission` via an append-only
 * `AffiliateCommissionReversal` ledger row — NEVER by deleting or
 * mutating the original `affiliateAmount`/`profitBaseAmount` (see that
 * repository's own doc comment).
 *
 * ## Idempotency
 * `AffiliateCommissionReversalRepository.createIfNotExists` is keyed on
 * `financialAdjustmentId`'s database-level unique constraint — the
 * authoritative guarantee under a duplicate/redelivered refund webhook,
 * never only an application-level pre-check. A repeat call for the same
 * `financialAdjustmentId` returns the already-recorded reversal
 * unchanged and never re-applies it to `AffiliateCommission.reversedAmount`
 * a second time.
 */
export class ReverseAffiliateCommissionUseCase {
  constructor(
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly reversals: AffiliateCommissionReversalRepository,
  ) {}

  async execute(input: ReverseAffiliateCommissionInput): Promise<AffiliateCommissionRecord | null> {
    const existingReversal = await this.reversals.findByFinancialAdjustmentId(input.financialAdjustmentId);
    if (existingReversal) {
      return this.affiliateCommissions.findById(existingReversal.affiliateCommissionId);
    }

    const commission = await this.affiliateCommissions.findById(input.affiliateCommissionId);
    if (!commission) {
      return null;
    }

    // A CANCELLED/EXPIRED commission was never payable in the first
    // place — nothing to claw back. An already-fully-REVERSED commission
    // has nothing left to reverse either.
    if (commission.status === "CANCELLED" || commission.status === "EXPIRED" || commission.status === "REVERSED") {
      return commission;
    }

    // Module 96 Financial Integrity Hardening Pass: the amount to apply
    // AND the row's mutation are both decided/applied atomically inside
    // `applyReversalAtomically`'s own row lock — never from this
    // pre-lock `commission` read, which can be stale under concurrency
    // (see that method's own doc comment on the race it closes).
    const updated = await this.affiliateCommissions.applyReversalAtomically(
      commission.id,
      input.financialAdjustmentId,
      (current) => {
        const reversalAmount = calculateAffiliateCommissionReversal({
          affiliateAmount: current.affiliateAmount,
          alreadyReversedAmount: current.reversedAmount,
          refundedAmount: input.refundedAmount,
          paymentAmount: input.paymentAmount,
          isFullRefund: input.isFullRefund,
        });
        if (reversalAmount <= 0) {
          return null;
        }
        return { amount: reversalAmount, reason: input.reason };
      },
    );

    if (updated) {
      logger.info("affiliate.commission.reversed", {
        affiliateCommissionId: commission.id,
        financialAdjustmentId: input.financialAdjustmentId,
        amount: updated.reversedAmount - commission.reversedAmount,
      });
    }

    return updated ?? commission;
  }
}
