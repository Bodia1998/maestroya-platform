import { roundToCents } from "@/domain/services/money";

/**
 * Module 64 — Pricing & Commission Engine: the single, centralized
 * definition of how a Quote's LABOR and MATERIALS line items combine into
 * a Total price. This supersedes the ad hoc "sum of items" arithmetic that
 * used to live inline in `CalculateJobCommissionBreakdownUseCase`
 * (labor/materials were summed there, then handed straight to
 * `commission-policy.ts`) — that use case now calls this service instead,
 * so there is exactly one place that knows "Total = Labour + Materials."
 *
 * Money convention: same as `money.ts`/`commission-policy.ts` — plain
 * `number`s, rounded to whole cents via `roundToCents` at every arithmetic
 * step, no arbitrary-precision decimal library. Pure and deterministic:
 * never reads a database, never trusts a client-supplied total.
 *
 * ## Extension point
 * `adjustments` is reserved for a future pipeline of price modifiers —
 * VAT/IVA is already handled as its own later stage by
 * `domain/services/tax-engine.ts`, but *this* file is where a future
 * module would plug in promotions, coupons, discount codes, or seasonal
 * campaigns that change the pre-tax Total itself. `PricingAdjustment` is
 * deliberately typed as `never` today — no variant exists yet, so the
 * field can only ever be omitted or passed as an empty array — precisely
 * so this file's one existing business rule (Total = Labour + Materials)
 * never has to change shape to make room for a feature that doesn't exist
 * yet. When that day comes: add a variant to a `PricingAdjustment` union,
 * apply it inside `calculate()`, and nothing upstream (
 * `CommissionCalculationService`, any use case) needs to change — the
 * exact same "closed contract, open implementation" shape
 * `TaxCalculatorRegistry` already uses for countries.
 */

/** Reserved for future price modifiers (promotions/coupons/discount
 *  codes/seasonal campaigns). No variant exists yet — see this file's own
 *  doc comment. */
export type PricingAdjustment = never;

export interface PricingCalculationInput {
  /** Sum of a Quote's LABOR-category QuoteItem amounts. Never negative. */
  labour: number;
  /** Sum of a Quote's MATERIALS-category QuoteItem amounts. Never
   *  negative. Under Module 64's flat commission model, materials are
   *  part of the Total exactly like labour — see `commission-calculation-
   *  service.ts` for why that matters. */
  materials: number;
  /** Reserved extension point — see this file's own doc comment. Always
   *  omit today; no adjustment types exist yet. */
  adjustments?: readonly PricingAdjustment[];
}

export interface PricingBreakdown {
  labour: number;
  materials: number;
  /** `labour + materials`, rounded to whole cents. */
  total: number;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

/**
 * Module 64's pricing engine. Deliberately narrow — this service only
 * ever computes `Total = Labour + Materials`; it never knows about
 * commission, tax, or who purchased the materials (see
 * `materials-procurement-rules.ts` for that orthogonal concern). Kept as
 * its own class (rather than folded into `CommissionCalculationService`)
 * so a future caller that needs a Total without a commission figure (e.g.
 * a quote-preview UI) can depend on this alone.
 */
export class PricingCalculationService {
  calculate(input: PricingCalculationInput): PricingBreakdown {
    assertNonNegative(input.labour, "labour");
    assertNonNegative(input.materials, "materials");

    const labour = roundToCents(input.labour);
    const materials = roundToCents(input.materials);
    const total = roundToCents(labour + materials);

    return { labour, materials, total };
  }
}

/** Singleton instance — this service has no per-request state, same
 *  convention `SPAIN_IVA_CALCULATOR` establishes for `TaxCalculator`
 *  implementations. */
export const PRICING_CALCULATION_SERVICE = new PricingCalculationService();
