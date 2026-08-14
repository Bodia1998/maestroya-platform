import {
  COMMISSION_CALCULATION_SERVICE,
  DEFAULT_COMMISSION_RATE_BPS,
} from "@/domain/services/commission-calculation-service";

/**
 * Module 22 — Commission & Financial: the Module-22-facing integration
 * point over Module 64's commission engine
 * (`domain/services/commission-calculation-service.ts`). This file used
 * to contain the actual commission math itself (a 7.5% customer platform
 * fee + a 7.5% professional commission, both on labour only); as of
 * Module 64 that math has been REMOVED from here and now lives in exactly
 * one place, `CommissionCalculationService.calculate()` — this file only
 * adapts that engine's input/output shape to the vocabulary the rest of
 * Module 22 (financial use cases, `tax-engine.ts`) already uses
 * (`laborSubtotal`/`materialsSubtotal`/`CommissionBreakdown`), so none of
 * those call sites needed to be rewritten to talk to
 * `CommissionCalculationService` directly. Do not re-add any commission
 * arithmetic here — every number below is derived by delegating to
 * `COMMISSION_CALCULATION_SERVICE`, never recomputed.
 *
 * New business rule (Module 64, definitive — see that module's own
 * worked example): MaestroYa charges a single flat 10% commission on a
 * Quote's TOTAL (labour + materials), regardless of who purchased the
 * materials. There is no longer a separate customer-facing platform fee —
 * the customer pays exactly `laborSubtotal + materialsSubtotal`, and the
 * commission is deducted entirely from the professional's payout.
 */

export interface CommissionRates {
  /** Basis points MaestroYa charges as its flat commission on a Quote's
   *  TOTAL (labour + materials). 1000 = 10%. Replaces the removed
   *  `customerPlatformFeeRateBps`/`professionalCommissionRateBps` pair —
   *  see this file's own doc comment. */
  commissionRateBps: number;
}

/**
 * The rate in effect today, per Module 64's "Default rate." Deliberately
 * not hardcoded into any calculation call site — every use case reads the
 * current rate through `CommissionRateRepository` (backed by
 * `PlatformSetting`, see `prisma-commission-rate-repository.ts`), falling
 * back to this constant only if no `PlatformSetting` row exists yet.
 */
export const DEFAULT_COMMISSION_RATES: CommissionRates = {
  commissionRateBps: DEFAULT_COMMISSION_RATE_BPS,
};

export interface CommissionBreakdownInput {
  /** Sum of a Quote's LABOR-category QuoteItem amounts. Never negative. */
  laborSubtotal: number;
  /** Sum of a Quote's MATERIALS-category QuoteItem amounts. Never
   *  negative. Commissionable under Module 64 — see this file's own doc
   *  comment. */
  materialsSubtotal: number;
  rates: CommissionRates;
}

/**
 * The full internal financial breakdown for a single Quote/Job/Payment.
 * NOT a DTO — application-layer DTOs (see `application/dto/financial.dto.ts`)
 * project a customer-safe or professional-safe subset of these fields;
 * this shape itself is for internal (admin/ledger-writing) use only and
 * must never be returned to a customer or professional as-is.
 */
export interface CommissionBreakdown {
  laborSubtotal: number;
  materialsSubtotal: number;
  /** `laborSubtotal + materialsSubtotal` — the flat commission's base
   *  under Module 64 (was labour-only under the removed Module 22
   *  split). Kept as its own named field (rather than callers reading
   *  `laborSubtotal + materialsSubtotal` directly) so every call site is
   *  explicit about "this is the commission base." */
  commissionBase: number;
  /** `commissionBase * rates.commissionRateBps / 10000` — MaestroYa's
   *  flat commission, deducted entirely from the professional's payout.
   *  There is no longer a separate customer-facing platform fee. */
  commission: number;
  /** `commissionBase - commission` — what the professional/company
   *  actually receives. */
  professionalPayout: number;
  /** Always equal to `commission` — MaestroYa's own gross revenue
   *  recognized from this Payment, before any future Stripe
   *  processing-fee deduction (Module 12) or IVA (Module 26). Kept as its
   *  own named field for the same reason `commissionBase` is. */
  platformGrossRevenue: number;
  /** `laborSubtotal + materialsSubtotal` — what the customer actually
   *  pays. Equal to `commissionBase` under the flat model (unlike the
   *  removed dual-fee model, nothing is added on top), kept as its own
   *  named field so call sites reading "what does the customer pay"
   *  don't need to know that identity holds. */
  customerTotalPayable: number;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

/**
 * Computes the full commission breakdown for a Quote/Job. Deliberately a
 * thin adapter over `CommissionCalculationService.calculate()` — see this
 * file's own doc comment. Deterministic and side-effect free: never reads
 * a database, never trusts a client-supplied amount (callers must always
 * derive `laborSubtotal`/`materialsSubtotal` from QuoteItem.category
 * server-side, never accept them directly from a request body).
 */
export function calculateCommissionBreakdown(input: CommissionBreakdownInput): CommissionBreakdown {
  assertNonNegative(input.laborSubtotal, "laborSubtotal");
  assertNonNegative(input.materialsSubtotal, "materialsSubtotal");
  assertNonNegative(input.rates.commissionRateBps, "commissionRateBps");

  const result = COMMISSION_CALCULATION_SERVICE.calculate({
    labour: input.laborSubtotal,
    materials: input.materialsSubtotal,
    commissionRateBps: input.rates.commissionRateBps,
  });

  return {
    laborSubtotal: result.labour,
    materialsSubtotal: result.materials,
    commissionBase: result.total,
    commission: result.commission,
    professionalPayout: result.professionalPayout,
    platformGrossRevenue: result.commission,
    customerTotalPayable: result.total,
  };
}
