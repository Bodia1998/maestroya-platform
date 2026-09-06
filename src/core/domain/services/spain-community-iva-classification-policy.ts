import { TaxCalculationError } from "@/domain/errors/domain-error";
import { SPAIN_IVA_RATES_BPS } from "@/domain/services/spain-iva-calculator";
import type { CustomerTypeValue } from "@/domain/value-objects/customer-type";
import type { QuoteOperationTypeValue } from "@/domain/value-objects/quote-operation-type";

/**
 * Module 97 — Tax & IVA Production Integration, Phases 3-4.
 *
 * Decides WHICH Spain IVA rate a Quote's operation qualifies for, given
 * the customer's tax classification and the legally-relevant
 * characteristics of the operation. This file does not itself calculate
 * any tax amount — it only resolves a `rateBps` (and a self-describing
 * classification/reason) that a caller then passes to the existing Module
 * 36/78 tax engine (`SpainIvaCalculator`/`calculateMaestroyaTaxBreakdown`)
 * exactly the way any other caller-supplied `rateBps` override already
 * flows through that engine. This is the integration point Phase 4 of the
 * module spec requires; it never duplicates `SpainIvaCalculator`'s own
 * arithmetic.
 *
 * ## Why this is not `COMMUNITY_OF_OWNERS ? 10% : 21%`
 * Ley 37/1992 (and the royal decrees interpreting it) does not grant
 * Comunidades de Propietarios a blanket reduced rate — the reduced rate
 * (art. 91.Uno.2.10º) applies to specific renovation/repair execution-of-
 * works contracts on buildings/parts of buildings used as dwellings,
 * subject to conditions including (at minimum) the nature of the work
 * (qualifying renovation/repair, not ordinary maintenance) and a cap on
 * how much of the total consideration is materials. This policy encodes
 * that shape — customer type -> operation type -> property use ->
 * materials ratio -> rate — rather than a single boolean branch, per the
 * module spec's explicit Phase 4 instruction.
 *
 * ## What is NOT decided here (Phase 20 — no legal overreach)
 * The exact qualifying-work definition and the materials-ratio threshold
 * below are this codebase's best-effort encoding of the publicly known
 * shape of the rule, NOT a substitute for asesor fiscal / abogado
 * sign-off. Every branch that reaches a REDUCED (10%) outcome, and every
 * branch that discards a case as "insufufficient data," sets
 * `requiresLegalConfirmation: true` — no Quote's IVA rate is ever silently
 * treated as legally final on this policy's authority alone. See
 * MODULE_97_TAX_IVA_PRODUCTION_INTEGRATION_REPORT.md for the full list of
 * assumptions requiring confirmation.
 *
 * ## Scope
 * This policy only ever adjusts the rate away from the general 21% rate
 * for `COMMUNITY_OF_OWNERS` customers. `PRIVATE_CUSTOMER`/`COMPANY`
 * customers may, under Spanish law, separately qualify for reduced-rate
 * treatment on private-dwelling renovation work under the same article —
 * that broader eligibility is explicitly OUT of scope for Module 97 (the
 * spec's Phase 4 only asks for the Community rule) and is called out as a
 * follow-up in the module report, not silently implemented here.
 *
 * ## Repair vs. renovation (Module 97 correction pass, Step 2)
 * `QuoteOperationTypeValue` (domain/value-objects/quote-operation-type.ts)
 * has a single `RENOVATION_OR_REPAIR` value rather than separate `REPAIR`
 * and `RENOVATION` values. This is deliberate, not an oversight: art.
 * 91.Uno.2.10º grants the same reduced-rate treatment to "obras de
 * renovación y reparación" as a single qualifying category — this
 * codebase has found no basis in the rule's own text for the two to ever
 * require different eligibility conditions, so splitting the enum would
 * add a distinction this policy would immediately treat identically,
 * which is exactly the kind of invented-but-unused complexity Step 2's
 * own "do not introduce duplicate enums if an equivalent already exists"
 * instruction warns against. If a future asesor-confirmed rule ever DOES
 * require treating repair and renovation differently, split the enum
 * value then, with the specific rule that motivates it documented
 * alongside the split.
 */

/** Materials-ratio threshold (materials amount / taxable amount) above
 *  which qualifying renovation/repair work no longer receives the reduced
 *  rate — commonly cited as 40% (materials cannot exceed 40% of the total
 *  consideration) under art. 91.Uno.2.10º. Expressed as a fraction (never
 *  inlined elsewhere) so it reads as a single, auditable assumption
 *  requiring asesor fiscal confirmation before this policy's REDUCED
 *  outcomes are relied upon in production — see this file's own doc
 *  comment. "Does not exceed 40%" is read as an inclusive boundary:
 *  exactly 40% still qualifies, only *above* 40% does not — see the
 *  boundary test in this file's own test suite.
 *
 *  Correction pass (Module 97 follow-up): the eligibility comparison
 *  itself (`isWithinMaterialsThreshold` below) never divides — Spanish
 *  law's own phrasing ("no exceda del 40%") is a boundary test on a
 *  ratio of two currency amounts, and `materialsAmount / taxableAmount`
 *  as a JS floating-point division can misclassify a value that is
 *  legally exactly at the boundary (e.g. an amount whose true ratio is
 *  40.00% can round to 40.000000001% or 39.999999999% in IEEE 754). The
 *  comparison instead cross-multiplies whole-cent integers — exact,
 *  never floating-point — see `isWithinMaterialsThreshold`'s own doc
 *  comment. This constant stays the single documented source of truth
 *  for the threshold value itself; only *how it's compared* changed. */
export const COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO = 0.4;

/** `COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO` expressed in basis points
 *  (10000 = 100%) — the form every other rate in this codebase
 *  (`rateBps`) is already expressed in, and the form
 *  `isWithinMaterialsThreshold`'s integer cross-multiplication needs. */
const MATERIALS_RATIO_THRESHOLD_BPS = Math.round(COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO * 10000);

/**
 * Whole-cent-integer, division-free check of "materials do not exceed
 * `COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO` of the taxable base."
 * Amounts are currency (2 decimal places) — `Math.round(amount * 100)`
 * converts each to an exact integer cent count (currency amounts never
 * carry enough fractional precision to lose information here), and the
 * threshold in basis points lets the whole comparison run as
 * `materialsCents * 10000 <= taxableCents * thresholdBps` — a single
 * integer comparison, safe up to far larger amounts than this platform's
 * `Decimal(10,2)` schema columns can ever hold, and with zero rounding
 * drift at the boundary (Module 97 correction pass, Step 5: "use exact
 * arithmetic; do not use JavaScript floating-point division for the
 * eligibility decision itself"). `taxableAmount === 0` is always within
 * threshold (there is no material-heavy operation with a zero base). */
function isWithinMaterialsThreshold(materialsAmount: number, taxableAmount: number): boolean {
  if (taxableAmount === 0) return true;
  const materialsCents = Math.round(materialsAmount * 100);
  const taxableCents = Math.round(taxableAmount * 100);
  return materialsCents * 10000 <= taxableCents * MATERIALS_RATIO_THRESHOLD_BPS;
}

export type TaxClassificationCode =
  | "ES_STANDARD_GENERAL"
  | "ES_COMMUNITY_INSUFFICIENT_DATA_DEFAULTED_GENERAL"
  | "ES_COMMUNITY_NON_QUALIFYING_OPERATION_GENERAL"
  | "ES_COMMUNITY_NON_RESIDENTIAL_GENERAL"
  | "ES_COMMUNITY_MATERIAL_HEAVY_GENERAL"
  | "ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED";

export interface CommunityIvaClassificationInput {
  customerType: CustomerTypeValue;
  /** Undefined/null means "not supplied" — never coerced to OTHER or any
   *  other assumption; see this file's INSUFFICIENT_DATA branch. */
  operationType?: QuoteOperationTypeValue | null;
  isResidentialProperty?: boolean | null;
  /** The Quote's taxable base (labour + materials), matching
   *  `MaestroYaTaxCalculationResult.customerTaxableBase` /
   *  `PriceBreakdown.taxableAmount`'s own convention. Never negative. */
  taxableAmount: number;
  /** The portion of `taxableAmount` that is MATERIALS-category. Never
   *  negative, never greater than `taxableAmount`. */
  materialsAmount: number;
}

export interface CommunityIvaClassificationResult {
  rateBps: number;
  classificationCode: TaxClassificationCode;
  /** See this file's own doc comment — true whenever a human must confirm
   *  this outcome (asesor fiscal / abogado) before it is relied upon for
   *  a real, production invoice. */
  requiresLegalConfirmation: boolean;
  reason: string;
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TaxCalculationError(`${label} must be a non-negative finite number.`);
  }
}

/**
 * Resolves the Spain IVA rate for a Quote's operation. Pure and
 * side-effect free, same convention as every other file in
 * `domain/services/tax-*`/`domain/services/spain-*`.
 */
export function classifyCommunityIvaRate(
  input: CommunityIvaClassificationInput,
): CommunityIvaClassificationResult {
  assertNonNegativeFinite(input.taxableAmount, "taxableAmount");
  assertNonNegativeFinite(input.materialsAmount, "materialsAmount");
  if (input.materialsAmount > input.taxableAmount) {
    throw new TaxCalculationError("materialsAmount cannot exceed taxableAmount.");
  }

  if (input.customerType !== "COMMUNITY_OF_OWNERS") {
    return {
      rateBps: SPAIN_IVA_RATES_BPS.GENERAL,
      classificationCode: "ES_STANDARD_GENERAL",
      requiresLegalConfirmation: false,
      reason:
        "Customer is not a Comunidad de Propietarios; the Module 97 community policy does not apply — general rate.",
    };
  }

  if (input.operationType == null || input.isResidentialProperty == null) {
    return {
      rateBps: SPAIN_IVA_RATES_BPS.GENERAL,
      classificationCode: "ES_COMMUNITY_INSUFFICIENT_DATA_DEFAULTED_GENERAL",
      requiresLegalConfirmation: true,
      reason:
        "Customer is a Comunidad de Propietarios but operationType/isResidentialProperty was not supplied — " +
        "defaulted to the general rate rather than guessing a reduced rate; requires legal confirmation before " +
        "the missing facts are entered and this Quote is relied upon for the reduced rate.",
    };
  }

  if (input.operationType !== "RENOVATION_OR_REPAIR") {
    return {
      rateBps: SPAIN_IVA_RATES_BPS.GENERAL,
      classificationCode: "ES_COMMUNITY_NON_QUALIFYING_OPERATION_GENERAL",
      requiresLegalConfirmation: false,
      reason: `Operation type "${input.operationType}" is not qualifying renovation/repair work — general rate.`,
    };
  }

  if (!input.isResidentialProperty) {
    return {
      rateBps: SPAIN_IVA_RATES_BPS.GENERAL,
      classificationCode: "ES_COMMUNITY_NON_RESIDENTIAL_GENERAL",
      requiresLegalConfirmation: false,
      reason: "Property is not used as a dwelling — the reduced rate's residential-use condition is not met.",
    };
  }

  // Cosmetic only (the "reason" string) — never the eligibility decision
  // itself, see isWithinMaterialsThreshold's own doc comment.
  const materialsRatioForDisplay = input.taxableAmount === 0 ? 0 : input.materialsAmount / input.taxableAmount;
  if (!isWithinMaterialsThreshold(input.materialsAmount, input.taxableAmount)) {
    return {
      rateBps: SPAIN_IVA_RATES_BPS.GENERAL,
      classificationCode: "ES_COMMUNITY_MATERIAL_HEAVY_GENERAL",
      requiresLegalConfirmation: true,
      reason:
        `Materials are ${(materialsRatioForDisplay * 100).toFixed(2)}% of the taxable base, above the ` +
        `${(COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO * 100).toFixed(0)}% threshold this policy applies for ` +
        "qualifying renovation/repair work — treated as material-heavy and safely defaulted to the general rate; " +
        "the exact threshold requires asesor fiscal confirmation.",
    };
  }

  return {
    rateBps: SPAIN_IVA_RATES_BPS.REDUCED,
    classificationCode: "ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED",
    requiresLegalConfirmation: true,
    reason:
      "Comunidad de Propietarios, qualifying renovation/repair work on a residential property, materials within " +
      "the applied threshold — reduced rate applies pending asesor fiscal confirmation of this specific operation.",
  };
}
