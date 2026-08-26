import { TaxCalculationError } from "@/domain/errors/domain-error";
import {
  DEFAULT_COMMISSION_RATES,
  calculateCommissionBreakdown,
  type CommissionRates,
} from "@/domain/services/commission-policy";
import { roundToCents } from "@/domain/services/money";
import { DEFAULT_TAX_CALCULATORS } from "@/domain/services/tax-engine";
import {
  resolveTaxCalculator,
  type TaxCalculatorRegistry,
} from "@/domain/services/tax-calculator";

/**
 * Module 78 — IVA / Tax Integration: the single authoritative tax
 * calculation layer for MaestroYa, sitting directly on top of (never
 * duplicating) Module 64's commission engine
 * (`commission-policy.ts`/`commission-calculation-service.ts`) and Module
 * 36's country-agnostic tax contract (`tax-calculator.ts`,
 * `spain-iva-calculator.ts`, `tax-engine.ts`).
 *
 * ## Why this file exists (what `tax-engine.ts` does NOT cover)
 * `calculatePriceBreakdown` (`tax-engine.ts`) already computes the
 * customer-facing side correctly: taxable base = labour + materials, IVA
 * on top, MaestroYa's flat commission shown as an informational figure
 * deducted from the professional. It never modeled — and this module adds
 * — the side Module 78's own spec requires:
 *
 *   1. The professional's OWN invoice/self-billing tax figures: their net
 *      base after MaestroYa's commission, and the IVA on THAT base (the
 *      professional, not MaestroYa, is the one who issues an invoice for
 *      this net amount under the current commercial/self-billing model —
 *      see the Module 78 spec's "PROFESSIONAL → MAESTROYA INVOICE"
 *      section). This is NOT "extra payout money" — it's tax data that
 *      must be represented as such (never silently merged into a payout
 *      figure the way `CommissionCalculationService.professionalPayout`
 *      already is).
 *   2. The distinction between professional-supplied materials (priced,
 *      commissionable, taxable — Scenario A) and customer-purchased
 *      materials (never priced by MaestroYa at all — `QuoteMaterial` has
 *      no amount field, see `quote-repository.ts`'s own doc comment —
 *      never commissionable, never part of any MaestroYa-side taxable
 *      base — Scenario B). `calculatePriceBreakdown`'s `materialsAmount`
 *      and `CommissionCalculationService`'s `materials` input make no such
 *      distinction; see MODULE_78_IMPLEMENTATION_REPORT.md, "Problems
 *      found," for the gap this surfaced in `CalculateJobCommissionBreakdownUseCase`.
 *   3. IRPF withholding as an explicit, first-class (but currently always
 *      zero) field — per direct guidance from Agencia Tributaria relayed
 *      in the Module 78 spec, MaestroYa does not withhold IRPF from
 *      professionals under the current intermediary model. This is
 *      encoded as a default, not a hardcoded absence, so a future policy
 *      change never requires a new field, only a new default/input.
 *   4. Enough structure (`calculateTaxReversal`) for Module 79 to compute
 *      a credit note's original/refunded/remaining IVA without
 *      recreating any tax math of its own.
 *
 * ## Reuse, not duplication
 * The commission math (base, rate, amount, professional net-of-commission
 * base) is always obtained by calling `calculateCommissionBreakdown` —
 * this file never re-derives `total * rateBps / 10000` itself. The IVA
 * math (base -> amount, rate validation) is always obtained by calling
 * the resolved `TaxCalculator` (Spain: `SpainIvaCalculator`) — this file
 * never re-derives `base * rateBps / 10000` itself either. The SAME
 * calculator/rate is used for both the customer-facing IVA and the
 * professional's own invoice IVA, since both are IVA on the same
 * underlying supply category — this is what guarantees the two never
 * silently diverge into two different "IVA implementations."
 *
 * ## Money convention
 * Same as every other file in `domain/services/` — plain `number`s,
 * rounded to whole cents via `roundToCents` at every arithmetic step, no
 * arbitrary-precision decimal library. Pure and side-effect free: never
 * reads a database, never trusts a client-supplied amount.
 */

/**
 * The current MaestroYa/AEAT-confirmed IRPF withholding rate: zero.
 * MaestroYa does not withhold IRPF from professionals under the current
 * intermediary business model (see the Module 78 spec's "IRPF" section).
 * Deliberately NOT hardcoded as an absence of a withholding concept —
 * `MaestroYaTaxCalculationInput.irpfWithholdingRateBps` accepts an
 * explicit override so a future confirmed policy change never requires a
 * new field, only a new value — but every caller that omits it gets this
 * documented default, never a silently different behavior.
 */
export const CURRENT_IRPF_WITHHOLDING_RATE_BPS = 0;

export interface MaestroYaTaxCalculationInput {
  /** Sum of a Quote's LABOR-category QuoteItem amounts. Never negative. */
  labourAmount: number;
  /** Sum of a Quote's MATERIALS-category QuoteItem amounts that the
   *  PROFESSIONAL purchased and priced (Scenario A). Never negative.
   *  Commissionable and taxable exactly like `labourAmount`. */
  professionalMaterialsAmount: number;
  /** Informational only — materials the CUSTOMER purchased directly
   *  (Scenario B). Never negative. Defaults to 0. Never entered into
   *  `customerTaxableBase`, `commissionBase`, or `professionalNetBase`:
   *  MaestroYa never sells, prices, taxes, or commissions materials the
   *  professional did not themselves supply — see this file's own doc
   *  comment and the Module 78 spec's "MATERIALS" section. Kept as an
   *  explicit field (rather than simply omitted) so a persisted
   *  `MaestroYaTaxCalculationResult` is self-describing about why a
   *  known materials cost isn't reflected in any of the taxed amounts. */
  customerMaterialsAmount?: number;
  /** ISO 3166-1 alpha-2 country code selecting which `TaxCalculator`
   *  applies, e.g. `"ES"`. */
  countryCode: string;
  /** Commission rates to use; defaults to `DEFAULT_COMMISSION_RATES`
   *  (Module 64's 10% flat rate) — same convention as
   *  `calculateCommissionBreakdown`/`calculatePriceBreakdown`. Callers
   *  should pass the platform's *current* rate (read from
   *  `CommissionRateRepository`), never a hardcoded literal. */
  commissionRates?: CommissionRates;
  /** Optional explicit IVA rate (bps), e.g. Spain's reduced (1000) or
   *  super-reduced (400) rate. Omit to use the resolved calculator's own
   *  default (Spain: the 21% general rate). Applied identically to both
   *  the customer-facing IVA and the professional's own invoice IVA. */
  taxRateBps?: number;
  /** Override registry — defaults to `DEFAULT_TAX_CALCULATORS`
   *  (`tax-engine.ts`). Exists so tests (and any future country rollout
   *  still under a feature flag) can calculate against a calculator set
   *  that isn't module-global. */
  taxCalculators?: TaxCalculatorRegistry;
  /** IRPF withholding rate in bps. Defaults to
   *  `CURRENT_IRPF_WITHHOLDING_RATE_BPS` (0) — see that constant's own
   *  doc comment. Never inferred per-professional; a caller passing a
   *  non-default value must be acting on an explicit, confirmed policy
   *  change, never a per-professional guess. */
  irpfWithholdingRateBps?: number;
}

/**
 * The full Module 78 tax breakdown for a single Quote/Job. Deliberately
 * keeps every accounting concept the spec calls out as its own named
 * field — see the Module 78 spec's "CRITICAL ACCOUNTING DISTINCTION"
 * section — rather than collapsing any of them together. NOT a DTO: same
 * "internal shape, project a safe subset per audience" convention
 * `CommissionBreakdown` already establishes.
 */
export interface MaestroYaTaxCalculationResult {
  countryCode: string;

  /** Inputs, echoed back (rounded) so this result is self-describing. */
  labourBase: number;
  professionalMaterialsBase: number;
  /** Always informational — see `MaestroYaTaxCalculationInput.customerMaterialsAmount`'s
   *  own doc comment. Never part of any base below. */
  customerMaterialsBase: number;

  // --- Customer-facing ---
  /** `labourBase + professionalMaterialsBase` — what the customer is
   *  charged IVA on, and the base MaestroYa's commission is charged on.
   *  Deliberately never includes `customerMaterialsBase` or any IVA
   *  amount. */
  customerTaxableBase: number;
  customerVatRateBps: number;
  customerVatAmount: number;
  /** `customerTaxableBase + customerVatAmount` — the full amount the
   *  customer pays. */
  customerGrossTotal: number;

  // --- MaestroYa commission (delegates to Module 64, never re-derived) ---
  /** Always equal to `customerTaxableBase` — kept as its own named field
   *  so every call site reading "what is commission charged on" doesn't
   *  need to know that identity holds, same convention
   *  `CommissionBreakdown.commissionBase` already establishes. */
  commissionBase: number;
  commissionRateBps: number;
  commissionAmount: number;

  // --- Professional invoice (self-billing) — new for Module 78 ---
  /** `commissionBase - commissionAmount` — the professional's own taxable
   *  base for their invoice to MaestroYa. Equal to
   *  `CommissionBreakdown.professionalPayout`, but named for what it IS
   *  here (a taxable base, not a payout figure) — see this file's own
   *  doc comment on why the two must never be conflated. */
  professionalNetBase: number;
  professionalVatRateBps: number;
  /** IVA on `professionalNetBase` — the professional's own IVA, computed
   *  by the same `TaxCalculator` and rate as `customerVatAmount`, but on
   *  a different base. Never derived from `customerVatAmount`. */
  professionalVatAmount: number;
  /** `professionalNetBase + professionalVatAmount` — the professional's
   *  invoice total before any IRPF withholding. */
  professionalInvoiceGrossTotal: number;

  // --- IRPF ---
  irpfWithholdingRateBps: number;
  /** `professionalNetBase * irpfWithholdingRateBps / 10000` — IRPF is
   *  withheld (when it ever is) on the net service base, never on IVA.
   *  Always 0 under `CURRENT_IRPF_WITHHOLDING_RATE_BPS`. */
  irpfWithholdingAmount: number;

  // --- Payout ---
  /** `professionalInvoiceGrossTotal - irpfWithholdingAmount` — the amount
   *  MaestroYa actually owes the professional once their invoice (net +
   *  IVA) is honored, net of any IRPF withholding. Under the current
   *  IRPF=0 configuration this equals `professionalInvoiceGrossTotal`
   *  exactly. NOTE: this is the tax-correct payout figure; it is
   *  intentionally NOT wired into Module 76's `ExecuteProfessionalPayoutUseCase`
   *  by this module — see MODULE_78_IMPLEMENTATION_REPORT.md, "Remaining
   *  risks," for why that wiring is a Module 79 decision, not a Module 78
   *  one. */
  professionalPayoutAmount: number;
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TaxCalculationError(`${label} must be a non-negative finite number.`);
  }
}

/**
 * Computes the full Module 78 tax breakdown for a Quote/Job. Deterministic
 * and side-effect free: never reads a database, never calls an external
 * tax provider, never trusts a client-supplied tax/commission/IVA amount.
 * Callers must always derive `labourAmount`/`professionalMaterialsAmount`
 * server-side (see `CalculateJobTaxBreakdownUseCase`), the same way
 * `CalculateJobCommissionBreakdownUseCase` already derives its own
 * `laborSubtotal`/`materialsSubtotal`.
 */
export function calculateMaestroYaTaxBreakdown(
  input: MaestroYaTaxCalculationInput,
): MaestroYaTaxCalculationResult {
  assertNonNegativeFinite(input.labourAmount, "labourAmount");
  assertNonNegativeFinite(input.professionalMaterialsAmount, "professionalMaterialsAmount");
  const customerMaterialsAmount = input.customerMaterialsAmount ?? 0;
  assertNonNegativeFinite(customerMaterialsAmount, "customerMaterialsAmount");

  const irpfWithholdingRateBps = input.irpfWithholdingRateBps ?? CURRENT_IRPF_WITHHOLDING_RATE_BPS;
  if (!Number.isFinite(irpfWithholdingRateBps) || irpfWithholdingRateBps < 0 || irpfWithholdingRateBps > 10000) {
    throw new TaxCalculationError("irpfWithholdingRateBps must be between 0 and 10000.");
  }

  const commissionRates = input.commissionRates ?? DEFAULT_COMMISSION_RATES;
  // Single source of truth for the commission math — Module 64's engine,
  // never re-derived here. Deliberately fed ONLY the professional-supplied
  // materials amount: customer-purchased materials (Scenario B) are never
  // commissionable — see this file's own doc comment, point 2.
  const commission = calculateCommissionBreakdown({
    laborSubtotal: input.labourAmount,
    materialsSubtotal: input.professionalMaterialsAmount,
    rates: commissionRates,
  });

  const registry = input.taxCalculators ?? DEFAULT_TAX_CALCULATORS;
  const calculator = resolveTaxCalculator(input.countryCode, registry);

  const customerTaxableBase = commission.commissionBase; // labour + professional materials
  const customerVat = calculator.calculate({
    taxableAmount: customerTaxableBase,
    rateBps: input.taxRateBps,
  });
  const customerGrossTotal = roundToCents(customerTaxableBase + customerVat.taxAmount);

  const professionalNetBase = commission.professionalPayout;
  // Same calculator/rate as the customer side — see this file's own doc
  // comment on why one IVA implementation, applied twice on two different
  // bases, is what prevents the two from ever silently diverging.
  const professionalVat = calculator.calculate({
    taxableAmount: professionalNetBase,
    rateBps: customerVat.rateBps,
  });
  const professionalInvoiceGrossTotal = roundToCents(professionalNetBase + professionalVat.taxAmount);

  const irpfWithholdingAmount = roundToCents((professionalNetBase * irpfWithholdingRateBps) / 10000);
  const professionalPayoutAmount = roundToCents(
    professionalInvoiceGrossTotal - irpfWithholdingAmount,
  );

  return {
    countryCode: customerVat.countryCode,
    labourBase: commission.laborSubtotal,
    professionalMaterialsBase: commission.materialsSubtotal,
    customerMaterialsBase: roundToCents(customerMaterialsAmount),

    customerTaxableBase,
    customerVatRateBps: customerVat.rateBps,
    customerVatAmount: customerVat.taxAmount,
    customerGrossTotal,

    commissionBase: commission.commissionBase,
    commissionRateBps: commissionRates.commissionRateBps,
    commissionAmount: commission.commission,

    professionalNetBase,
    professionalVatRateBps: professionalVat.rateBps,
    professionalVatAmount: professionalVat.taxAmount,
    professionalInvoiceGrossTotal,

    irpfWithholdingRateBps,
    irpfWithholdingAmount,

    professionalPayoutAmount,
  };
}

/**
 * Refund/credit-note tax-reversal preparation. Deliberately NOT a
 * credit-note generator (that's Module 79's job, per the spec's
 * "REFUNDS AND TAX" section) — this only derives the original/refunded/
 * remaining IVA (and the equivalent professional-side figures) a Module 79
 * credit note would need, from an already-computed
 * `MaestroYaTaxCalculationResult` and the gross amount being refunded.
 *
 * Proportional by design: `refundedGrossAmount` is taken as a fraction of
 * `original.customerGrossTotal`, and every other refunded figure is
 * derived from that same ratio. For a full refund (`refundedGrossAmount
 * === original.customerGrossTotal`) every "remaining" figure is exactly
 * zero and every "refunded" figure exactly matches the original — this is
 * the common case Module 77's refund execution already handles. Amounts
 * are always reconciled to round exactly (`refundedCustomerVatAmount` is
 * derived as `refundedGrossAmount - refundedCustomerTaxableBase`, never
 * independently rounded) so a partial refund's base+IVA always sums back
 * to the refunded gross amount to the cent.
 */
export interface TaxReversalResult {
  countryCode: string;

  originalCustomerTaxableBase: number;
  originalCustomerVatAmount: number;
  originalCustomerGrossTotal: number;

  refundedCustomerTaxableBase: number;
  refundedCustomerVatAmount: number;
  refundedCustomerGrossAmount: number;

  remainingCustomerTaxableBase: number;
  remainingCustomerVatAmount: number;
  remainingCustomerGrossAmount: number;

  /** Proportional estimate for the professional's own credit note — see
   *  this file's own doc comment. */
  refundedCommissionAmount: number;
  refundedProfessionalNetBase: number;
  refundedProfessionalVatAmount: number;
  refundedProfessionalInvoiceGrossAmount: number;
  refundedIrpfWithholdingAmount: number;
}

export function calculateTaxReversal(
  original: MaestroYaTaxCalculationResult,
  refundedGrossAmount: number,
): TaxReversalResult {
  assertNonNegativeFinite(refundedGrossAmount, "refundedGrossAmount");
  const refundedAmount = roundToCents(refundedGrossAmount);
  if (refundedAmount > original.customerGrossTotal) {
    throw new TaxCalculationError(
      "refundedGrossAmount cannot exceed the original customerGrossTotal.",
    );
  }

  const ratio = original.customerGrossTotal === 0 ? 0 : refundedAmount / original.customerGrossTotal;

  const refundedCustomerTaxableBase = roundToCents(original.customerTaxableBase * ratio);
  const refundedCustomerVatAmount = roundToCents(refundedAmount - refundedCustomerTaxableBase);

  const refundedCommissionAmount = roundToCents(original.commissionAmount * ratio);
  const refundedProfessionalNetBase = roundToCents(
    refundedCustomerTaxableBase - refundedCommissionAmount,
  );
  const refundedProfessionalVatAmount = roundToCents(original.professionalVatAmount * ratio);
  const refundedProfessionalInvoiceGrossAmount = roundToCents(
    refundedProfessionalNetBase + refundedProfessionalVatAmount,
  );
  const refundedIrpfWithholdingAmount = roundToCents(original.irpfWithholdingAmount * ratio);

  return {
    countryCode: original.countryCode,

    originalCustomerTaxableBase: original.customerTaxableBase,
    originalCustomerVatAmount: original.customerVatAmount,
    originalCustomerGrossTotal: original.customerGrossTotal,

    refundedCustomerTaxableBase,
    refundedCustomerVatAmount,
    refundedCustomerGrossAmount: refundedAmount,

    remainingCustomerTaxableBase: roundToCents(
      original.customerTaxableBase - refundedCustomerTaxableBase,
    ),
    remainingCustomerVatAmount: roundToCents(original.customerVatAmount - refundedCustomerVatAmount),
    remainingCustomerGrossAmount: roundToCents(original.customerGrossTotal - refundedAmount),

    refundedCommissionAmount,
    refundedProfessionalNetBase,
    refundedProfessionalVatAmount,
    refundedProfessionalInvoiceGrossAmount,
    refundedIrpfWithholdingAmount,
  };
}
