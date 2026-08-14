import { roundToCents } from "@/domain/services/money";

/**
 * Module 61 — Affiliate & Partner System: the single, centralized
 * definition of how much an affiliate partner earns from a booking.
 *
 * IMPORTANT — this is the module spec's own worked example, verbatim:
 *   Booking: 1,000€
 *   MaestroYa platform commission: 10% = 100€
 *   Affiliate receives: 10% OF MAESTROYA'S COMMISSION = 10€
 *   MaestroYa keeps: 90€
 *
 * This module NEVER recomputes "MaestroYa's platform commission" itself —
 * that figure is Module 22's existing `Commission.amount` (see
 * `commission-policy.ts`, which this module does not import from and does
 * not modify), read here only as an already-known, already-persisted
 * input. `calculateAffiliateCommission` takes that amount as a plain
 * number and returns 10% of it — nothing here ever multiplies against a
 * booking/labor/materials subtotal, which is precisely what would make
 * this "10% of the booking value" instead of "10% of MaestroYa's
 * commission."
 *
 * Rate convention: basis points (bps), matching `CommissionRates`'
 * `professionalCommissionRateBps` convention exactly — 1000 bps = 10%.
 * Money convention: plain `number`, rounded to whole cents via the shared
 * `roundToCents` (see money.ts's own doc comment for why this codebase
 * uses plain numbers rather than a decimal library).
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

/**
 * Computes 10% (or whatever `rateBps` is configured to) of an already-known
 * MaestroYa platform commission amount. Pure, deterministic, no I/O —
 * unit-testable in isolation, same convention `calculateCommissionBreakdown`
 * establishes for Module 22.
 */
export function calculateAffiliateCommission(
  platformCommissionAmount: number,
  rateBps: number = AFFILIATE_COMMISSION_RATE_BPS,
): number {
  assertNonNegative(platformCommissionAmount, "platformCommissionAmount");
  assertNonNegative(rateBps, "rateBps");
  return roundToCents((roundToCents(platformCommissionAmount) * rateBps) / 10000);
}
