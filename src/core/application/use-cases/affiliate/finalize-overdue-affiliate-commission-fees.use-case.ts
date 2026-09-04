import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 96 Financial Integrity Hardening Pass — Risk 3: a commission
 * whose Stripe fee never arrives currently (before this pass) just gets
 * re-examined by `ReconcileAffiliateCommissionStripeFeeUseCase` forever,
 * via the maintenance sweep's fee-reconciliation backstop, silently
 * treating `attributableCostAmount = 0` as the working value the whole
 * time — with nothing ever distinguishing "genuinely a €0-fee payment"
 * from "we simply never found out." Worse, that same zero-cost
 * commission was fully payable in the meantime.
 *
 * This use case is the bounded backstop: once a zero-cost commission has
 * existed for longer than `FEE_FINALIZATION_WINDOW_MS` without its fee
 * ever being reconciled, it is stamped
 * `AffiliateCommission.costFinalizationFailedAt` — an explicit,
 * durable, queryable "finalization failed / requires review" outcome
 * (see that column's own schema doc comment), which
 * `listApprovedForPartner` then excludes from payout eligibility (Risk
 * 3's hard requirement: a commission with unresolved cost past the
 * window must not proceed to payout).
 *
 * ## Window choice — 7 days
 * Stripe's own `balance_transaction`/`charge.updated` fee data is
 * reported essentially immediately (seconds to minutes) in the
 * overwhelming common case, and this module's OWN true-race backstop
 * (`ReconcileAffiliateCommissionStripeFeeUseCase`) already closes the
 * only realistic gap (two webhook-adjacent writes landing at the same
 * instant) within one sweep cycle (currently daily — see `vercel.json`).
 * 7 days is therefore deliberately generous — many multiples of any
 * realistic delay — while still being a genuinely FINITE bound rather
 * than the previous "forever" behavior, and short enough that a
 * partner's payout is never blocked for an operationally unreasonable
 * time by a single stuck commission (an admin can review and clear the
 * flag well before a partner's next payout cycle in practice). Revisit
 * this constant if a real production incident shows Stripe fee data
 * genuinely arriving later than this in some legitimate case.
 *
 * ## Never mutates accounting
 * Exactly like every other Module 96 correction path: this NEVER
 * touches `attributableCostAmount`/`profitBaseAmount`/`affiliateAmount`.
 * If a real fee is found in the future for a commission already flagged,
 * `ReconcileAffiliateCommissionStripeFeeUseCase`'s own reversal-ledger
 * correction still runs as normal (it does not consult this flag) — but
 * see `listPendingFeeReconciliation`'s own doc comment: once flagged,
 * the automatic backstop no longer retries the fee lookup itself, so in
 * practice a genuinely late fee arriving after the window closed is
 * expected to require the SAME webhook-triggered path
 * (`reconcileAffiliateCommissionStripeFeeForPayment`, called directly
 * from the payments webhook route on `charge.updated`) or manual admin
 * action to surface — the sweep backstop stepping aside is a deliberate
 * "stop guessing, a human should look at this now" choice, not an
 * oversight.
 */
const FEE_FINALIZATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export class FinalizeOverdueAffiliateCommissionFeesUseCase {
  constructor(private readonly affiliateCommissions: AffiliateCommissionRepository) {}

  async execute(now: Date, limit: number): Promise<AffiliateCommissionRecord[]> {
    const cutoff = new Date(now.getTime() - FEE_FINALIZATION_WINDOW_MS);
    const overdue = await this.affiliateCommissions.listFeeFinalizationOverdue(cutoff, limit);

    const flagged: AffiliateCommissionRecord[] = [];
    for (const commission of overdue) {
      const updated = await this.affiliateCommissions.markCostFinalizationFailed(commission.id, now);
      flagged.push(updated);
      logger.error("affiliate.commission.fee_finalization_failed", {
        affiliateCommissionId: commission.id,
        partnerId: commission.partnerId,
        platformCommissionRefId: commission.platformCommissionRefId,
        createdAt: commission.createdAt.toISOString(),
        windowMs: FEE_FINALIZATION_WINDOW_MS,
      });
    }
    return flagged;
  }
}
