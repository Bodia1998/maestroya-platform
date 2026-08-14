import { TaxCalculationError } from "@/domain/errors/domain-error";
import {
  DEFAULT_COMMISSION_RATES,
  calculateCommissionBreakdown,
  type CommissionRates,
} from "@/domain/services/commission-policy";
import { roundToCents } from "@/domain/services/money";
import { SPAIN_IVA_CALCULATOR } from "@/domain/services/spain-iva-calculator";
import {
  resolveTaxCalculator,
  type TaxCalculatorRegistry,
} from "@/domain/services/tax-calculator";

/**
 * Module 36 — Tax Engine Preparation: the provider-independent Tax Engine
 * itself. This file is the only place that combines two previously
 * separate concerns — Module 22/64's commission engine and a country's
 * `TaxCalculator` — into one customer-facing `PriceBreakdown`. Neither the
 * commission engine nor a `TaxCalculator` implementation needs to know the
 * other exists; this module is their integration point, exactly as
 * `docs/MODULE_22_COMMISSION_FINANCIAL.md`'s "Module 26 (IVA/Tax)
 * boundary" anticipated.
 *
 * Explicitly OUT of scope here (per the module spec): invoice generation,
 * Stripe/PaymentGateway integration, calls to an external tax provider
 * (e.g. AEAT), and any persistence — this is a pure, side-effect-free
 * calculation, same convention as `calculateCommissionBreakdown`.
 *
 * Tax base (updated for Module 64): Spanish law (and VAT/IVA generally)
 * taxes the full consideration a customer pays for a supply — labor and
 * materials are what's being sold, so `taxableAmount` here is
 * `serviceAmount + materialsAmount`. Under Module 64's flat commission
 * model MaestroYa's own commission is deducted entirely from the
 * professional's payout and is never part of what the customer pays, so
 * (unlike the removed dual-fee model, which added a customer-facing
 * platform fee on top before taxing it) the commission is never added to
 * the taxable base here.
 */

/** Registry of the countries the Tax Engine currently supports. Extending
 *  to a new country never requires editing this map's existing entries or
 *  any existing country's calculator — implement `TaxCalculator` in a new
 *  file (see `spain-iva-calculator.ts`) and add one entry here (or pass a
 *  caller-supplied registry via `PriceBreakdownInput.taxCalculators` for
 *  contexts that shouldn't depend on this module-level default, e.g.
 *  tests). */
export const DEFAULT_TAX_CALCULATORS: TaxCalculatorRegistry = new Map([
  [SPAIN_IVA_CALCULATOR.countryCode, SPAIN_IVA_CALCULATOR],
]);

export interface PriceBreakdownInput {
  /** Sum of LABOR-category amounts — same meaning as
   *  `CommissionBreakdownInput.laborSubtotal`. Never negative. */
  serviceAmount: number;
  /** Sum of MATERIALS-category amounts — same meaning as
   *  `CommissionBreakdownInput.materialsSubtotal`. Never negative. Part
   *  of both the taxable base and (as of Module 64) the commission base. */
  materialsAmount: number;
  /** ISO 3166-1 alpha-2 country code selecting which `TaxCalculator` in
   *  `taxCalculators` applies, e.g. `"ES"`. */
  countryCode: string;
  /** Commission rates to use; defaults to `DEFAULT_COMMISSION_RATES`, same
   *  as `calculateCommissionBreakdown`'s own convention. */
  commissionRates?: CommissionRates;
  /** Optional explicit tax rate (bps), e.g. Spain's reduced (1000) or
   *  super-reduced (400) IVA rate. Omit to use the resolved calculator's
   *  own default (Spain: the 21% general rate). */
  taxRateBps?: number;
  /** Override registry — defaults to `DEFAULT_TAX_CALCULATORS`. Exists so
   *  tests (and any future country rollout still under a feature flag)
   *  can calculate against a calculator set that isn't module-global. */
  taxCalculators?: TaxCalculatorRegistry;
}

/**
 * The full customer-facing price breakdown for a Quote/Job: what the
 * service and materials cost, what MaestroYa's own flat commission is
 * (informational — deducted from the professional, not charged to the
 * customer), and what tax applies on top of what the customer actually
 * pays.
 */
export interface PriceBreakdown {
  countryCode: string;
  serviceAmount: number;
  materialsAmount: number;
  /** MaestroYa's flat commission (`CommissionBreakdown.commission`) —
   *  informational only. Under Module 64 this is deducted from the
   *  professional's payout, never charged to the customer, and is
   *  therefore never part of `taxableAmount`. */
  platformCommission: number;
  /** `serviceAmount + materialsAmount`, rounded — the base tax is
   *  calculated on; equal to what the customer pays before tax. */
  taxableAmount: number;
  /** The rate actually used to compute `taxAmount`, in bps — always
   *  present, even when the caller didn't pass `taxRateBps`, so this
   *  breakdown is self-describing (e.g. for a receipt line reading "IVA
   *  (21%): €X"). */
  taxRateBps: number;
  taxAmount: number;
  /** `taxableAmount + taxAmount` — the final amount the customer pays. */
  totalAmount: number;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TaxCalculationError(`${label} must be a non-negative finite number.`);
  }
}

function assertNonEmptyCountryCode(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TaxCalculationError("countryCode must be a non-empty string.");
  }
}

/**
 * Computes the full price breakdown for a Quote/Job in one country.
 * Deterministic and side-effect free: never reads a database, never calls
 * an external tax provider, never trusts a client-supplied tax or
 * commission amount — `serviceAmount`/`materialsAmount` must always be
 * derived server-side the same way `CalculateJobCommissionBreakdownUseCase`
 * already derives `laborSubtotal`/`materialsSubtotal` from
 * QuoteItem.category.
 *
 * Deliberately reuses `calculateCommissionBreakdown` rather than
 * re-deriving the commission math — this is the single reuse point the
 * module spec requires ("reuse the existing commission engine; do not
 * duplicate commission calculations").
 */
export function calculatePriceBreakdown(input: PriceBreakdownInput): PriceBreakdown {
  assertNonNegative(input.serviceAmount, "serviceAmount");
  assertNonNegative(input.materialsAmount, "materialsAmount");
  assertNonEmptyCountryCode(input.countryCode);

  const commissionRates = input.commissionRates ?? DEFAULT_COMMISSION_RATES;
  const commission = calculateCommissionBreakdown({
    laborSubtotal: input.serviceAmount,
    materialsSubtotal: input.materialsAmount,
    rates: commissionRates,
  });

  const registry = input.taxCalculators ?? DEFAULT_TAX_CALCULATORS;
  const calculator = resolveTaxCalculator(input.countryCode, registry);

  const taxableAmount = roundToCents(commission.laborSubtotal + commission.materialsSubtotal);
  const tax = calculator.calculate({ taxableAmount, rateBps: input.taxRateBps });
  const totalAmount = roundToCents(taxableAmount + tax.taxAmount);

  return {
    countryCode: tax.countryCode,
    serviceAmount: commission.laborSubtotal,
    materialsAmount: commission.materialsSubtotal,
    platformCommission: commission.commission,
    taxableAmount,
    taxRateBps: tax.rateBps,
    taxAmount: tax.taxAmount,
    totalAmount,
  };
}
