import { roundToCents } from "@/domain/services/money";
import type { AffiliateCommissionRecord } from "@/domain/repositories/affiliate-commission-repository";

/**
 * Module 61 — Affiliate & Partner System: pure payout-eligibility and
 * batch-selection rules, kept separate from `CreatePartnerPayoutUseCase` so
 * both can be unit tested independently — same "pure domain function
 * decides, use case orchestrates I/O" split every other rule file in this
 * codebase follows (e.g. `referral-visit-dedup-rules.ts`).
 */

/** Default minimum accumulated APPROVED commission total before a payout
 *  can be created — a small platform fee/administrative-cost floor, the
 *  same rationale a real affiliate program (Amazon Associates, Stripe's own
 *  Connect payout minimums, etc.) uses to avoid processing a €0.10 bank
 *  transfer. Overridable per partner via `Partner.minimumPayoutThreshold`
 *  — this constant is only the fallback for a brand-new partner. */
export const DEFAULT_MINIMUM_PAYOUT_THRESHOLD = 50;

export function isEligibleForPayout(approvedTotal: number, threshold: number): boolean {
  return roundToCents(approvedTotal) >= roundToCents(threshold) && approvedTotal > 0;
}

export interface PayoutBatchSelection {
  commissionIds: string[];
  amount: number;
}

/**
 * Selects every `APPROVED` commission for a partner into a single payout
 * batch (this module settles the *entire* approved balance at once — there
 * is no partial-payout concept, which keeps `AffiliateCommission.payoutId`
 * unambiguous: a commission is either fully in a payout or not in one at
 * all). Returns `null` when the partner isn't eligible (see
 * `isEligibleForPayout`), so `CreatePartnerPayoutUseCase` never has to
 * duplicate the threshold check itself.
 */
export function selectPayoutBatch(
  approvedCommissions: readonly Pick<AffiliateCommissionRecord, "id" | "affiliateAmount">[],
  threshold: number,
): PayoutBatchSelection | null {
  const amount = roundToCents(approvedCommissions.reduce((sum, c) => sum + c.affiliateAmount, 0));
  if (!isEligibleForPayout(amount, threshold)) {
    return null;
  }
  return { commissionIds: approvedCommissions.map((c) => c.id), amount };
}
