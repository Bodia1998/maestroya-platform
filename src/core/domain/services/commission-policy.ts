import { roundToCents } from "@/domain/services/money";

/**
 * Module 22 — Commission & Financial: the single, centralized definition of
 * MaestroYa's dual-sided commission model. Every other Module 22 use case
 * calls into this file rather than re-deriving the math — see
 * docs/MODULE_22_COMMISSION_FINANCIAL.md, "Commission Policy," for the
 * business rationale.
 *
 * Business model (definitive, see the module spec):
 *   commissionBase        = laborSubtotal            (materials NEVER included)
 *   customerPlatformFee    = commissionBase * customerPlatformFeeRateBps / 10000
 *   professionalCommission = commissionBase * professionalCommissionRateBps / 10000
 *
 * Rates are basis points (bps), matching the existing (schema-only, unused
 * until this module) `Commission.rateBps` convention — see that model's own
 * doc comment on why bps rather than a float percentage. 750 bps = 7.5%.
 *
 * Money convention: plain `number`s rounded to whole cents at every
 * arithmetic step via `roundToCents` — the same convention money.ts already
 * established for Quote/QuoteItem math (see that file's own doc comment on
 * why this codebase doesn't use a decimal library). Calculations here are
 * pure and deterministic: the same input always produces the same output,
 * with no hidden state, no I/O, no randomness — this is what makes the
 * rounding behavior independently unit-testable (see
 * tests/unit/core/domain/commission-policy.test.ts).
 *
 * IVA / VAT (future Module 26) is explicitly NOT calculated here — this
 * module only produces the pre-tax breakdown Module 26 will need as its
 * own input. See docs/MODULE_22_COMMISSION_FINANCIAL.md, "Module 26 (IVA)
 * boundary."
 */

export interface CommissionRates {
  /** Basis points charged to the customer, on top of the labor+materials
   *  price, as MaestroYa's own platform fee. 750 = 7.5%. */
  customerPlatformFeeRateBps: number;
  /** Basis points deducted from the professional's/company's labor
   *  earnings as MaestroYa's commission. 750 = 7.5%. */
  professionalCommissionRateBps: number;
}

/**
 * The rates in effect today, per the module spec's "Default rates."
 * Deliberately not hardcoded into any calculation call site — every use
 * case reads the current rates through CommissionRateRepository (backed by
 * PlatformSetting, see prisma-commission-rate-repository.ts), falling back
 * to this constant only if no PlatformSetting row exists yet (e.g. a fresh
 * environment before the seed script runs). This is what lets a future
 * pricing experiment change rates via ops (no deploy) without touching this
 * file or any use case.
 */
export const DEFAULT_COMMISSION_RATES: CommissionRates = {
  customerPlatformFeeRateBps: 750,
  professionalCommissionRateBps: 750,
};

export interface CommissionBreakdownInput {
  /** Sum of a Quote's LABOR-category QuoteItem amounts. Never negative. */
  laborSubtotal: number;
  /** Sum of a Quote's MATERIALS-category QuoteItem amounts. Never
   *  negative. Always excluded from the commission base. */
  materialsSubtotal: number;
  rates: CommissionRates;
}

/**
 * The full internal financial breakdown for a single Quote/Job/Payment.
 * NOT a DTO — application-layer DTOs (see application/dto/financial.dto.ts)
 * project a customer-safe or professional-safe subset of these fields;
 * this shape itself is for internal (admin/ledger-writing) use only and
 * must never be returned to a customer or professional as-is (see
 * docs/MODULE_22_COMMISSION_FINANCIAL.md, "Authorization").
 */
export interface CommissionBreakdown {
  laborSubtotal: number;
  materialsSubtotal: number;
  /** Always equal to laborSubtotal — kept as its own named field (rather
   *  than callers reading laborSubtotal directly) so every call site is
   *  explicit about "this is the commission base," matching the module
   *  spec's own vocabulary. */
  commissionBase: number;
  customerPlatformFee: number;
  professionalCommission: number;
  /** laborSubtotal - professionalCommission. Materials are never part of
   *  this figure — see CreateFinancialAdjustmentUseCase/
   *  RecordCommissionForPaymentUseCase for where materials are added back
   *  in to compute a professional's *total* payout. */
  professionalNetLaborEarnings: number;
  /** customerPlatformFee + professionalCommission — MaestroYa's own gross
   *  revenue recognized from this Payment, before any future Stripe
   *  processing-fee deduction (Module 12) or IVA (Module 26). */
  platformGrossRevenue: number;
  /** laborSubtotal + materialsSubtotal + customerPlatformFee — convenience
   *  total for "what does the customer actually pay," derived, not an
   *  independent input. */
  customerTotalPayable: number;
  /** professionalNetLaborEarnings + materialsSubtotal — convenience total
   *  for "what does the professional/company actually receive," derived,
   *  not an independent input. */
  professionalTotalNetEarnings: number;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

/**
 * Computes the full commission breakdown for a Quote/Job. Deterministic and
 * side-effect free — never reads a database, never trusts a
 * client-supplied amount (callers must always derive laborSubtotal/
 * materialsSubtotal from QuoteItem.category server-side, never accept them
 * directly from a request body).
 */
export function calculateCommissionBreakdown(input: CommissionBreakdownInput): CommissionBreakdown {
  assertNonNegative(input.laborSubtotal, "laborSubtotal");
  assertNonNegative(input.materialsSubtotal, "materialsSubtotal");
  assertNonNegative(input.rates.customerPlatformFeeRateBps, "customerPlatformFeeRateBps");
  assertNonNegative(input.rates.professionalCommissionRateBps, "professionalCommissionRateBps");

  const laborSubtotal = roundToCents(input.laborSubtotal);
  const materialsSubtotal = roundToCents(input.materialsSubtotal);
  const commissionBase = laborSubtotal;

  const customerPlatformFee = roundToCents((commissionBase * input.rates.customerPlatformFeeRateBps) / 10000);
  const professionalCommission = roundToCents(
    (commissionBase * input.rates.professionalCommissionRateBps) / 10000,
  );
  const professionalNetLaborEarnings = roundToCents(laborSubtotal - professionalCommission);
  const platformGrossRevenue = roundToCents(customerPlatformFee + professionalCommission);
  const customerTotalPayable = roundToCents(laborSubtotal + materialsSubtotal + customerPlatformFee);
  const professionalTotalNetEarnings = roundToCents(professionalNetLaborEarnings + materialsSubtotal);

  return {
    laborSubtotal,
    materialsSubtotal,
    commissionBase,
    customerPlatformFee,
    professionalCommission,
    professionalNetLaborEarnings,
    platformGrossRevenue,
    customerTotalPayable,
    professionalTotalNetEarnings,
  };
}
