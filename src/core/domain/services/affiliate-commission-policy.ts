import { roundToCents } from "@/domain/services/money";

/**
 * Module 61/96 — Affiliate & Partner System: the single, centralized
 * definition of how much an affiliate partner earns from a booking.
 *
 * ## Module 96 correction — profit base, not gross commission
 * The module spec's own worked example (still true, and still the
 * common case): a 1,000€ booking, MaestroYa platform commission 10% =
 * 100€, affiliate receives 10% of that = 10€, MaestroYa keeps 90€ — this
 * is exactly what the formula below produces whenever
 * `attributableCostAmount` is `0`.
 *
 * Module 96's production-wiring audit flagged that the pre-96 version of
 * this function computed the affiliate reward as 10% of the *gross*
 * platform commission unconditionally — i.e. it silently assumed
 * `attributableCostAmount` is always zero. That conflates "MaestroYa's
 * commission" with "MaestroYa's profit from this transaction": a real
 * transaction can carry costs directly attributable to it (Stripe payment
 * processing fees; a chargeback/dispute loss) that reduce what MaestroYa
 * actually keeps, and the affiliate is only owed 10% of what's actually
 * kept — never 10% of the top-line commission figure regardless of cost.
 *
 * `Affiliate Profit Base = platformCommissionAmount - attributableCostAmount`
 * `Affiliate Commission  = profitBase * rateBps / 10000`
 *
 * `attributableCostAmount` defaults to `0` — this codebase does not yet
 * persist a per-transaction Stripe processing-fee figure anywhere (see
 * `docs/MODULE_96...` report's "Financial Formula" section for the exact
 * repositories checked and confirmed empty of this data at audit time:
 * `commission-repository.ts`/`financial-ledger-repository.ts`/
 * `financial-adjustment-repository.ts`/`refund-repository.ts`/
 * `commission-policy.ts`, plus `platformGrossRevenue`'s own doc comment
 * in `commission-policy.ts`, which explicitly documents the Stripe fee as
 * a *future* deduction, "Module 12" placeholder — never actually wired).
 * Passing `0` there is therefore not a corner-cut default masking a real
 * figure; it is the honest value until a real fee-capture integration
 * exists to supply a non-zero one. The formula itself is unconditionally
 * correct and ready for that integration the moment it exists — no
 * further change to this function will be required, only a caller
 * supplying a real `attributableCostAmount`.
 *
 * This module NEVER recomputes "MaestroYa's platform commission" itself —
 * that figure is Module 22's existing `Commission.amount` (see
 * `commission-policy.ts`, which this module does not import from and does
 * not modify), read here only as an already-known, already-persisted
 * input. `calculateAffiliateCommission` never multiplies against a
 * booking/labor/materials subtotal, which is precisely what would make
 * this "10% of the booking value" instead of "10% of MaestroYa's profit."
 *
 * Rate convention: basis points (bps), matching `CommissionRates`'
 * `professionalCommissionRateBps` convention exactly — 1000 bps = 10%.
 * Money convention: plain `number`, rounded to whole cents via the shared
 * `roundToCents` (see money.ts's own doc comment for why this codebase
 * uses plain numbers rather than a decimal library) at every arithmetic
 * step — the profit base is rounded before the rate is applied, and the
 * final reward is rounded again, so no call site ever needs to round a
 * result of this function itself.
 */
export const AFFILIATE_COMMISSION_RATE_BPS = 1000;

/** How long a `PENDING` affiliate commission stays claimable before
 *  `ExpireAffiliateCommissionsUseCase` sweeps it to `EXPIRED` — see
 *  docs/MODULE_61's "Commission Ledger" section. 180 days gives an admin
 *  ample time to review/approve even a slow-moving dispute window, while
 *  still eventually closing out ledger rows nobody ever approved. */
export const AFFILIATE_COMMISSION_EXPIRY_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeAffiliateCommissionExpiry(createdAt: Date, days: number = AFFILIATE_COMMISSION_EXPIRY_DAYS): Date {
  return new Date(createdAt.getTime() + days * MS_PER_DAY);
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

export interface AffiliateCommissionInput {
  /** Module 22's already-recorded `Commission.amount` for this booking —
   *  never re-derived from a booking/labor/materials subtotal. */
  platformCommissionAmount: number;
  /** Directly attributable transaction costs/losses (payment processing
   *  fees, refunds, chargeback/dispute losses) already known at the time
   *  this commission is created — never overhead, salaries, marketing,
   *  tax, or anything not modeled per-transaction. Defaults to `0` — see
   *  this file's own doc comment for exactly why that default is honest,
   *  not fabricated. Must never exceed `platformCommissionAmount` (a
   *  cost larger than the commission itself would mean MaestroYa made no
   *  profit at all on this transaction — the profit base floors at `0`,
   *  it is never allowed to go negative here). */
  attributableCostAmount?: number;
  rateBps?: number;
}

export interface AffiliateCommissionResult {
  /** `roundToCents(platformCommissionAmount - attributableCostAmount)`,
   *  floored at `0`. The base the affiliate rate is actually applied to —
   *  persisted verbatim on `AffiliateCommission.profitBaseAmount` for
   *  auditability, so a later reader never has to recompute it from the
   *  other two fields to know what MaestroYa's stated profit was. */
  profitBaseAmount: number;
  /** `roundToCents(profitBaseAmount * rateBps / 10000)` — what the
   *  partner actually earns. */
  affiliateAmount: number;
}

/**
 * Computes the affiliate profit base and reward for an already-known
 * MaestroYa platform commission amount, net of any directly attributable
 * cost. Pure, deterministic, no I/O — unit-testable in isolation, same
 * convention `calculateCommissionBreakdown` establishes for Module 22.
 */
export interface AffiliateCommissionReversalInput {
  /** The commission's own already-recorded `affiliateAmount` — never
   *  mutated by a reversal, only read. */
  affiliateAmount: number;
  /** Sum of every reversal already applied against this commission
   *  before this one — `0` for the first reversal. Ensures a sequence of
   *  partial refunds against the same booking can never cumulatively
   *  reverse more than the partner was ever actually paid. */
  alreadyReversedAmount: number;
  /** This specific refund's amount (customer's gross currency) —
   *  `PaymentRefunded.amount`. */
  refundedAmount: number;
  /** The original Payment's total amount — `PaymentRefunded.amount` is
   *  compared against this to derive the refunded fraction for a partial
   *  reversal. */
  paymentAmount: number;
  /** `true` for `PaymentRefunded.newPaymentStatus === "REFUNDED"` (the
   *  Payment's entire capturable amount has now been refunded), `false`
   *  for `"PARTIALLY_REFUNDED"`. */
  isFullRefund: boolean;
}

/**
 * Module 96 — the affiliate-side mirror of Module 77's refund handling:
 * computes how much of an already-recorded `AffiliateCommission.
 * affiliateAmount` a given refund reverses.
 *
 * - Full refund: reverses whatever remains unreversed (`affiliateAmount -
 *   alreadyReversedAmount`) — the partner's net balance for this
 *   commission goes to exactly `0`, regardless of how many prior partial
 *   reversals already happened (never over- or under-reverses due to
 *   rounding drift across several partial refunds).
 * - Partial refund: reverses the SAME proportion of the affiliate
 *   commission as was refunded of the original payment — a 30% refund of
 *   the underlying transaction claws back 30% of what the partner earned
 *   from it, matching "the partner is only ever owed 10% of profit
 *   MaestroYa actually realized" (a refunded portion was never realized).
 *   Always capped so cumulative reversals can never exceed
 *   `affiliateAmount` even under a sequence of partial refunds that
 *   together add up to more than the original commission (rounding, or a
 *   final adjustment refund) — never a negative remaining balance.
 *
 * Pure, deterministic, no I/O — independently unit-testable, same
 * convention as `calculateAffiliateCommission`.
 */
export function calculateAffiliateCommissionReversal(input: AffiliateCommissionReversalInput): number {
  const affiliateAmount = roundToCents(input.affiliateAmount);
  const alreadyReversedAmount = roundToCents(input.alreadyReversedAmount);
  const remaining = roundToCents(Math.max(0, affiliateAmount - alreadyReversedAmount));

  if (input.isFullRefund) {
    return remaining;
  }

  assertNonNegative(input.refundedAmount, "refundedAmount");
  assertNonNegative(input.paymentAmount, "paymentAmount");
  if (input.paymentAmount <= 0) {
    return 0;
  }

  const fraction = Math.min(1, input.refundedAmount / input.paymentAmount);
  const proportional = roundToCents(affiliateAmount * fraction);
  return Math.min(remaining, proportional);
}

/**
 * Module 96 Financial Fix Pass — fee-timing reconciliation.
 *
 * Computes how much of an already-recorded `AffiliateCommission.
 * affiliateAmount` must be clawed back once the REAL Stripe fee becomes
 * known after the commission was already created with
 * `attributableCostAmount = 0` (see `ReconcileAffiliateCommissionStripeFeeUseCase`).
 * Pure, deterministic, no I/O — same convention as
 * `calculateAffiliateCommissionReversal`, which this deliberately mirrors
 * rather than replaces: this is not a second accounting model, it is the
 * same "recompute correct value, reverse the delta via the append-only
 * ledger, never mutate the original snapshot" pattern applied to a
 * different trigger (a late-arriving cost, not a refund).
 *
 * A real Stripe fee is never negative, so the corrected profit base can
 * only ever be lower than (or equal to) the one computed with `cost = 0`
 * — this function therefore only ever produces a reduction, never an
 * increase, matching the reversal ledger's existing FULL/PARTIAL-only
 * shape with no new "credit" case required. Capped so the cumulative
 * reversal (this correction plus any already-applied refund/dispute
 * reversal) can never exceed `affiliateAmount` — never a negative
 * payable balance.
 */
export interface AffiliateCommissionFeeCorrectionInput {
  /** Immutable — the commission's own already-recorded
   *  `platformCommissionAmount`. */
  platformCommissionAmount: number;
  /** Immutable — the commission's own already-recorded
   *  `affiliateAmount`, computed at creation time with `cost = 0`. Never
   *  mutated by this function; only ever read. */
  affiliateAmount: number;
  /** The real Stripe fee, now known — always > 0 when this is called
   *  (a caller with a 0 or missing fee has nothing to correct). */
  actualAttributableCostAmount: number;
  /** Sum of every reversal (refund, dispute, or a prior fee correction)
   *  already applied against this commission — `0` if none. */
  alreadyReversedAmount: number;
  rateBps: number;
}

export interface AffiliateCommissionFeeCorrectionResult {
  /** What `profitBaseAmount` would have been had the real fee been known
   *  at creation time — for the reversal reason string only, never
   *  written back onto the immutable commission snapshot. */
  correctedProfitBaseAmount: number;
  /** What `affiliateAmount` would have been had the real fee been known
   *  at creation time. */
  correctedAffiliateAmount: number;
  /** The amount to record as a new `AffiliateCommissionReversal` —
   *  `max(0, affiliateAmount - correctedAffiliateAmount)`, capped so
   *  `alreadyReversedAmount + reversalAmount` never exceeds
   *  `affiliateAmount`. `0` when the correction would not actually
   *  reduce anything (e.g. reversals from other sources already
   *  exhausted the balance). */
  reversalAmount: number;
}

export function calculateAffiliateCommissionFeeCorrection(
  input: AffiliateCommissionFeeCorrectionInput,
): AffiliateCommissionFeeCorrectionResult {
  const { profitBaseAmount: correctedProfitBaseAmount, affiliateAmount: correctedAffiliateAmount } = calculateAffiliateCommission({
    platformCommissionAmount: input.platformCommissionAmount,
    attributableCostAmount: input.actualAttributableCostAmount,
    rateBps: input.rateBps,
  });

  const affiliateAmount = roundToCents(input.affiliateAmount);
  const alreadyReversedAmount = roundToCents(input.alreadyReversedAmount);
  const remaining = roundToCents(Math.max(0, affiliateAmount - alreadyReversedAmount));

  // A real fee can only ever push the corrected amount down (or leave it
  // unchanged) relative to the cost=0 amount already recorded — but guard
  // defensively rather than assume: never let this function itself
  // *increase* a commission.
  const fullDelta = roundToCents(Math.max(0, affiliateAmount - correctedAffiliateAmount));
  const reversalAmount = Math.min(remaining, fullDelta);

  return { correctedProfitBaseAmount, correctedAffiliateAmount, reversalAmount };
}

export function calculateAffiliateCommission(input: AffiliateCommissionInput): AffiliateCommissionResult {
  const platformCommissionAmount = roundToCents(input.platformCommissionAmount);
  const attributableCostAmount = roundToCents(input.attributableCostAmount ?? 0);
  const rateBps = input.rateBps ?? AFFILIATE_COMMISSION_RATE_BPS;

  assertNonNegative(platformCommissionAmount, "platformCommissionAmount");
  assertNonNegative(attributableCostAmount, "attributableCostAmount");
  assertNonNegative(rateBps, "rateBps");

  const profitBaseAmount = roundToCents(Math.max(0, platformCommissionAmount - attributableCostAmount));
  const affiliateAmount = roundToCents((profitBaseAmount * rateBps) / 10000);

  return { profitBaseAmount, affiliateAmount };
}
