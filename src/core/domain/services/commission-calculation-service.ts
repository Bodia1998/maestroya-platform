import { roundToCents } from "@/domain/services/money";
import {
  PRICING_CALCULATION_SERVICE,
  type PricingAdjustment,
  type PricingCalculationService,
} from "@/domain/services/pricing-calculation-service";

/**
 * Module 64 — Pricing & Commission Engine: the single source of truth for
 * MaestroYa's commission math, replacing Module 22's original dual-sided
 * model (a 7.5% customer platform fee + a 7.5% professional commission,
 * both charged on labour only — see the now-superseded doc comment
 * `commission-policy.ts` used to carry). Every other file in this
 * codebase that needs "what does MaestroYa charge, what does the
 * professional keep" calls `calculate()` here — see
 * `commission-policy.ts` (kept as Module 22's thin, still-current
 * integration point) and the `financial` use cases — rather than
 * re-deriving the formula, so there is exactly one place this business
 * rule is expressed.
 *
 * ## Business rule (definitive — see the Module 64 spec's own worked
 * example)
 *   total          = labour + materials
 *   commission     = total * commissionRateBps / 10000
 *   professionalPayout = total - commission
 *
 * Flat and total-based: unlike the old model, materials ARE part of the
 * commission base, and there is no separate customer-facing fee — the
 * customer pays exactly `total` (see `total`/`PricingCalculationService`),
 * and the commission is deducted entirely from what the professional
 * receives. Worked example: Labour 5000€ + Materials 1000€ = Total 6000€
 * -> Commission 600€ (10%) -> Professional receives 5400€.
 *
 * Money convention: same as `money.ts` — plain `number`s, rounded to
 * whole cents via `roundToCents` at every arithmetic step. Pure and
 * side-effect free: never reads a database, never trusts a
 * client-supplied amount — callers must always derive `labour`/
 * `materials` from QuoteItem.category server-side (see
 * `CalculateJobCommissionBreakdownUseCase`), and the rate always comes
 * from `CommissionRateRepository`, never a call-site literal.
 *
 * ## Extension point
 * `adjustments` is forwarded verbatim to `PricingCalculationService` —
 * see that file's own doc comment for the full explanation of why this
 * is currently a `never`-typed no-op reserved for a future
 * VAT/promotions/coupons/affiliate/referral/seasonal-campaign pipeline.
 * Nothing in this class needs to change when that pipeline is
 * implemented; only `PricingCalculationService.calculate()`'s internals
 * would.
 */

/** Basis points; 1000 = 10.00%. The platform-wide default flat commission
 *  rate — see the module spec's own worked example. Deliberately not
 *  hardcoded into any calculation call site: every use case reads the
 *  current rate through `CommissionRateRepository` (backed by
 *  `PlatformSetting`, see `prisma-commission-rate-repository.ts`),
 *  falling back to this constant only if no `PlatformSetting` row exists
 *  yet — this is what lets a future pricing experiment change the rate
 *  via ops (no deploy) without touching this file or any use case. */
export const DEFAULT_COMMISSION_RATE_BPS = 1000;

export interface CommissionCalculationInput {
  /** Sum of a Quote's LABOR-category QuoteItem amounts. Never negative. */
  labour: number;
  /** Sum of a Quote's MATERIALS-category QuoteItem amounts. Never
   *  negative. Commissionable under Module 64, regardless of who
   *  purchased them (`materialsStrategy` — see
   *  `materials-procurement-rules.ts` — is entirely orthogonal to
   *  commission; the commission is charged on the *value* of the
   *  materials, never on who sourced them). */
  materials: number;
  /** Basis points; defaults to `DEFAULT_COMMISSION_RATE_BPS` (1000 =
   *  10%). Callers should pass the platform's *current* rate (read from
   *  `CommissionRateRepository`), never a hardcoded literal. */
  commissionRateBps?: number;
  /** Reserved extension point — see this file's own doc comment. Always
   *  omit today; no adjustment types exist yet. */
  adjustments?: readonly PricingAdjustment[];
}

/**
 * The full commission calculation for a single Quote/Job/Payment. NOT a
 * DTO — application-layer DTOs (see `application/dto/financial.dto.ts`)
 * project a customer-safe or professional-safe subset of these fields;
 * this shape itself is for internal (admin/ledger-writing) use only.
 */
export interface CommissionCalculationResult {
  labour: number;
  materials: number;
  /** `labour + materials` — both the price the customer pays and the
   *  commission base under Module 64's flat model. */
  total: number;
  /** The rate actually applied, in basis points — snapshot this onto any
   *  persisted record (e.g. `Commission.rateBps`) rather than
   *  re-deriving it later, which is lossy when `total` is zero. */
  commissionRateBps: number;
  /** `commissionRateBps` expressed as a percentage, e.g. `10` for 10%.
   *  Convenience for display/reporting call sites that would otherwise
   *  each independently write `commissionRateBps / 100`. */
  commissionPercentage: number;
  /** `total * commissionRateBps / 10000`, rounded to whole cents. Always
   *  `>= 0`. MaestroYa's own gross revenue recognized from this
   *  Payment. */
  commission: number;
  /** `total - commission`, rounded to whole cents. What the
   *  professional/company actually receives. */
  professionalPayout: number;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

export class CommissionCalculationService {
  constructor(
    private readonly pricing: PricingCalculationService = PRICING_CALCULATION_SERVICE,
  ) {}

  calculate(input: CommissionCalculationInput): CommissionCalculationResult {
    const commissionRateBps = input.commissionRateBps ?? DEFAULT_COMMISSION_RATE_BPS;
    assertNonNegative(commissionRateBps, "commissionRateBps");

    const pricing = this.pricing.calculate({
      labour: input.labour,
      materials: input.materials,
      adjustments: input.adjustments,
    });

    const commission = roundToCents((pricing.total * commissionRateBps) / 10000);
    // Guards the domain invariant "commission >= 0" independently of the
    // arithmetic above (which can never itself go negative given
    // assertNonNegative on both inputs, but this makes the invariant
    // explicit and future-proofs against a future adjustment type that
    // might otherwise violate it silently).
    if (commission < 0) {
      throw new Error("Commission must be a non-negative amount.");
    }
    const professionalPayout = roundToCents(pricing.total - commission);

    return {
      labour: pricing.labour,
      materials: pricing.materials,
      total: pricing.total,
      commissionRateBps,
      commissionPercentage: commissionRateBps / 100,
      commission,
      professionalPayout,
    };
  }
}

/** Singleton instance — this service has no per-request state, same
 *  convention `PRICING_CALCULATION_SERVICE`/`SPAIN_IVA_CALCULATOR`
 *  establish. */
export const COMMISSION_CALCULATION_SERVICE = new CommissionCalculationService();
