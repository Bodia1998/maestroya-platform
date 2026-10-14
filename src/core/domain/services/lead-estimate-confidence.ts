import { parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import type { ConfidencePolicy, RegionalCalibrationEntry } from "@/domain/services/lead-regional-calibration";
import type { LeadPricingConfidence } from "@/domain/services/lead-pricing";

/**
 * Module 164 — explainable ESTIMATE-CONFIDENCE score (decision D4). Pure, deterministic, no I/O.
 *
 * WHAT THE SCORE IS. An integer 0..10 that adds up named, independently inspectable pieces of EVIDENCE the system holds about
 * an estimate. Every point has a component and a reason code. It is a heuristic about how much evidence stands behind the
 * number — it is NOT a probability, NOT a measured accuracy and NOT "a 90% success rate". Whether a score of 7 corresponds to
 * 90% of estimates landing inside a tolerance of the real job value is an EMPIRICAL question that needs recorded outcomes
 * (see lead-estimate-accuracy.ts); until such a validation is recorded the score never claims it.
 *
 * WHY COMPLETENESS IS NOT ENOUGH. Valid, complete questionnaire answers earn at most 2 of the 10 points. The remaining points
 * come from the calibration evidence behind the category and the region, the tightness of the approved range, and — only when
 * a hold-out validation has actually been recorded and met the bar — empirical validation. Therefore:
 *   - a perfectly answered questionnaire with no approved regional parameters scores at most 2 (+0 elsewhere);
 *   - without any recorded validation the score can never exceed 8 and never earns a HIGH band;
 *   - a request whose category has no questionnaire earns 0 points for scope (nothing was asked, nothing is known).
 *
 * The component maxima and the spread / validation thresholds come from the versioned `ConfidencePolicy` in the calibration
 * configuration, not from this file. The shipped values are UNAPPROVED engineering defaults (D4 is not approved); because the
 * shipped calibration has no APPROVED entry, they influence no price today.
 */

export const ESTIMATE_CONFIDENCE_SCALE = 10;
export const ESTIMATE_CONFIDENCE_INTERPRETATION = "HEURISTIC_EVIDENCE_SCORE_NOT_AN_ACCURACY_ESTIMATE" as const;

export const CONFIDENCE_COMPONENT_CODES = ["SCOPE_ANSWERS", "CATEGORY_MATCH", "REGION_CALIBRATION", "ESTIMATE_PRECISION", "EMPIRICAL_VALIDATION"] as const;
export type ConfidenceComponentCode = (typeof CONFIDENCE_COMPONENT_CODES)[number];

export const CONFIDENCE_REASON_CODES = [
  "SCOPE_VALIDATED",
  "SCOPE_NOT_PROVIDED",
  "SCOPE_QUESTIONNAIRE_NOT_CONFIGURED",
  "SCOPE_CONFLICTING",
  "CATEGORY_EXACT",
  "CATEGORY_PARENT_ONLY",
  "CATEGORY_NO_PARAMETERS",
  "REGION_APPROVED_PARAMETERS",
  "REGION_NO_APPROVED_PARAMETERS",
  "RANGE_NARROW",
  "RANGE_MODERATE",
  "RANGE_WIDE",
  "RANGE_UNKNOWN",
  "VALIDATION_MET_BAR",
  "VALIDATION_BELOW_BAR",
  "VALIDATION_TOO_SMALL",
  "VALIDATION_NOT_RECORDED",
] as const;
export type ConfidenceReasonCode = (typeof CONFIDENCE_REASON_CODES)[number];

export interface ConfidenceComponent {
  code: ConfidenceComponentCode;
  points: number;
  maximum: number;
  reason: ConfidenceReasonCode;
}

/** Maxima of the five components; they sum to ESTIMATE_CONFIDENCE_SCALE. */
export const CONFIDENCE_COMPONENT_MAXIMA: Readonly<Record<ConfidenceComponentCode, number>> = Object.freeze({
  SCOPE_ANSWERS: 2,
  CATEGORY_MATCH: 2,
  REGION_CALIBRATION: 2,
  ESTIMATE_PRECISION: 2,
  EMPIRICAL_VALIDATION: 2,
});

export type ScoredScope = "VALIDATED" | "NOT_PROVIDED" | "QUESTIONNAIRE_NOT_CONFIGURED" | "CONFLICTING";

export interface EstimateConfidenceInput {
  scope: ScoredScope;
  /** The calibration entry the estimate is based on (null = none), and how it matched the request's category. */
  entry: RegionalCalibrationEntry | null;
  match: "CATEGORY" | "PARENT_CATEGORY" | null;
}

export interface EstimateConfidence {
  score: number;
  maximum: typeof ESTIMATE_CONFIDENCE_SCALE;
  threshold: number;
  meetsThreshold: boolean;
  components: readonly ConfidenceComponent[];
  /** The highest score any request can reach while no validation is recorded. */
  maximumWithoutValidation: number;
  interpretation: typeof ESTIMATE_CONFIDENCE_INTERPRETATION;
}

const FIXED_ONE = 1_000_000n;

/** (high - low) / (high + low) as a 6-digit fixed-point, or null when the range is unusable. */
function spreadFixed(entry: RegionalCalibrationEntry): bigint | null {
  const low = parseScaledDecimal(entry.jobValueLow, 2);
  const high = parseScaledDecimal(entry.jobValueHigh, 2);
  if (low === null || high === null || low <= 0n || high < low) return null;
  return ((high - low) * FIXED_ONE) / (high + low);
}

function precisionComponent(entry: RegionalCalibrationEntry | null, policy: ConfidencePolicy): ConfidenceComponent {
  const maximum = CONFIDENCE_COMPONENT_MAXIMA.ESTIMATE_PRECISION;
  if (!entry || entry.status !== "APPROVED") return { code: "ESTIMATE_PRECISION", points: 0, maximum, reason: "RANGE_UNKNOWN" };
  const spread = spreadFixed(entry);
  const narrow = parseScaledDecimal(policy.narrowSpreadMax, 6);
  const moderate = parseScaledDecimal(policy.moderateSpreadMax, 6);
  if (spread === null || narrow === null || moderate === null) return { code: "ESTIMATE_PRECISION", points: 0, maximum, reason: "RANGE_UNKNOWN" };
  if (spread <= narrow) return { code: "ESTIMATE_PRECISION", points: 2, maximum, reason: "RANGE_NARROW" };
  if (spread <= moderate) return { code: "ESTIMATE_PRECISION", points: 1, maximum, reason: "RANGE_MODERATE" };
  return { code: "ESTIMATE_PRECISION", points: 0, maximum, reason: "RANGE_WIDE" };
}

function validationComponent(entry: RegionalCalibrationEntry | null, policy: ConfidencePolicy): ConfidenceComponent {
  const maximum = CONFIDENCE_COMPONENT_MAXIMA.EMPIRICAL_VALIDATION;
  const validation = entry?.status === "APPROVED" ? entry.validation : undefined;
  if (!validation) return { code: "EMPIRICAL_VALIDATION", points: 0, maximum, reason: "VALIDATION_NOT_RECORDED" };
  if (validation.sampleSize < policy.minimumValidationSample) return { code: "EMPIRICAL_VALIDATION", points: 0, maximum, reason: "VALIDATION_TOO_SMALL" };
  const rate = parseScaledDecimal(validation.withinToleranceRate, 6);
  const bar = parseScaledDecimal(policy.minimumValidationRate, 6);
  if (rate === null || bar === null || rate < bar) return { code: "EMPIRICAL_VALIDATION", points: 0, maximum, reason: "VALIDATION_BELOW_BAR" };
  return { code: "EMPIRICAL_VALIDATION", points: maximum, maximum, reason: "VALIDATION_MET_BAR" };
}

/** Scores the evidence behind one estimate. Total, deterministic, never throws for well-formed input. */
export function scoreEstimateConfidence(input: EstimateConfidenceInput, policy: ConfidencePolicy): EstimateConfidence {
  const entry = input.entry && input.entry.status === "APPROVED" ? input.entry : null;

  const scope: ConfidenceComponent =
    input.scope === "VALIDATED"
      ? { code: "SCOPE_ANSWERS", points: 2, maximum: 2, reason: "SCOPE_VALIDATED" }
      : input.scope === "CONFLICTING"
        ? { code: "SCOPE_ANSWERS", points: 0, maximum: 2, reason: "SCOPE_CONFLICTING" }
        : input.scope === "QUESTIONNAIRE_NOT_CONFIGURED"
          ? { code: "SCOPE_ANSWERS", points: 0, maximum: 2, reason: "SCOPE_QUESTIONNAIRE_NOT_CONFIGURED" }
          : { code: "SCOPE_ANSWERS", points: 0, maximum: 2, reason: "SCOPE_NOT_PROVIDED" };

  const category: ConfidenceComponent = !entry
    ? { code: "CATEGORY_MATCH", points: 0, maximum: 2, reason: "CATEGORY_NO_PARAMETERS" }
    : input.match === "CATEGORY"
      ? { code: "CATEGORY_MATCH", points: 2, maximum: 2, reason: "CATEGORY_EXACT" }
      : { code: "CATEGORY_MATCH", points: 1, maximum: 2, reason: "CATEGORY_PARENT_ONLY" };

  const region: ConfidenceComponent = entry
    ? { code: "REGION_CALIBRATION", points: 2, maximum: 2, reason: "REGION_APPROVED_PARAMETERS" }
    : { code: "REGION_CALIBRATION", points: 0, maximum: 2, reason: "REGION_NO_APPROVED_PARAMETERS" };

  const precision = precisionComponent(entry, policy);
  const validation = validationComponent(entry, policy);

  const components = [scope, category, region, precision, validation] as const;
  const score = components.reduce((sum, c) => sum + c.points, 0);
  // The ceiling when no validation has been recorded: every other component at full marks.
  const maximumWithoutValidation = ESTIMATE_CONFIDENCE_SCALE - CONFIDENCE_COMPONENT_MAXIMA.EMPIRICAL_VALIDATION;
  return {
    score,
    maximum: ESTIMATE_CONFIDENCE_SCALE,
    threshold: policy.autoPublishMinimumScore,
    meetsThreshold: score >= policy.autoPublishMinimumScore,
    components,
    maximumWithoutValidation,
    interpretation: ESTIMATE_CONFIDENCE_INTERPRETATION,
  };
}

/**
 * Band stored in the publication snapshot (the existing LOW/MEDIUM/HIGH vocabulary). HIGH requires BOTH a score of at least 9
 * AND a validation that met the bar; a score without validation can never be HIGH.
 */
export function confidenceBand(confidence: Pick<EstimateConfidence, "score" | "components" | "threshold">): LeadPricingConfidence {
  const validated = confidence.components.some((c) => c.code === "EMPIRICAL_VALIDATION" && c.points > 0);
  if (validated && confidence.score >= 9) return "HIGH";
  if (confidence.score >= confidence.threshold) return "MEDIUM";
  return "LOW";
}
