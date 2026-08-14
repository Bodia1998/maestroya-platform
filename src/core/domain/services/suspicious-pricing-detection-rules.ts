import type { PricingBreakdown } from "@/domain/services/pricing-calculation-service";

/**
 * Module 65 — Trust & Integrity System: suspicious-pricing rule engine,
 * integrating with Module 64's `PricingCalculationService`/
 * `PricingBreakdown` (requirement #11) rather than re-deriving Total —
 * every caller here always passes an already-computed `PricingBreakdown`,
 * mirroring the "single source of truth" rule `commission-policy.ts`
 * documents for its own domain.
 */

export const VERY_LOW_LABOUR_RATIO = 0.05; // labour < 5% of total is suspicious
export const VERY_HIGH_MATERIALS_RATIO = 0.9; // materials > 90% of total is suspicious
export const EXTREME_QUOTE_MODIFICATION_RATIO = 0.6; // a >60% change between revisions
export const REPEATED_PRICING_ANOMALY_THRESHOLD = 3;

export interface SuspiciousPricingFinding {
  reason: "VERY_LOW_LABOUR" | "VERY_HIGH_MATERIALS" | "EXTREME_QUOTE_MODIFICATION" | "REPEATED_PRICING_ANOMALIES";
  detail: string;
}

/** Requirement #11 — "Very low labour" / "Very high materials": flags a
 *  Quote whose labour/materials split is implausible for genuine work
 *  (e.g. nearly all materials, negligible labour is a common pattern for
 *  disguising an off-platform cash job as a low-value marketplace Quote). */
export function detectPricingSplitAnomaly(breakdown: PricingBreakdown): SuspiciousPricingFinding[] {
  const findings: SuspiciousPricingFinding[] = [];
  if (breakdown.total <= 0) return findings;

  const labourRatio = breakdown.labour / breakdown.total;
  const materialsRatio = breakdown.materials / breakdown.total;

  if (labourRatio < VERY_LOW_LABOUR_RATIO) {
    findings.push({
      reason: "VERY_LOW_LABOUR",
      detail: `Labour is only ${(labourRatio * 100).toFixed(1)}% of the Quote total (threshold ${(VERY_LOW_LABOUR_RATIO * 100).toFixed(0)}%).`,
    });
  }

  if (materialsRatio > VERY_HIGH_MATERIALS_RATIO) {
    findings.push({
      reason: "VERY_HIGH_MATERIALS",
      detail: `Materials are ${(materialsRatio * 100).toFixed(1)}% of the Quote total (threshold ${(VERY_HIGH_MATERIALS_RATIO * 100).toFixed(0)}%).`,
    });
  }

  return findings;
}

/** Requirement #11 — "Extreme quote modifications": compares a Quote's
 *  total before/after an edit. */
export function detectExtremeQuoteModification(previousTotal: number, newTotal: number): SuspiciousPricingFinding | null {
  if (previousTotal <= 0) return null;
  const changeRatio = Math.abs(newTotal - previousTotal) / previousTotal;
  if (changeRatio <= EXTREME_QUOTE_MODIFICATION_RATIO) return null;
  return {
    reason: "EXTREME_QUOTE_MODIFICATION",
    detail: `Quote total changed by ${(changeRatio * 100).toFixed(1)}% between revisions (from ${previousTotal.toFixed(2)} to ${newTotal.toFixed(2)}, threshold ${(EXTREME_QUOTE_MODIFICATION_RATIO * 100).toFixed(0)}%).`,
  };
}

/** Requirement #11 — "Repeated pricing anomalies": a professional who
 *  repeatedly triggers the two checks above is a stronger signal than any
 *  single occurrence — `anomalyCountInWindow` is the caller-supplied
 *  rolling count of prior findings for this professional. */
export function detectRepeatedPricingAnomalies(professionalUserId: string, anomalyCountInWindow: number): SuspiciousPricingFinding | null {
  if (anomalyCountInWindow < REPEATED_PRICING_ANOMALY_THRESHOLD) return null;
  return {
    reason: "REPEATED_PRICING_ANOMALIES",
    detail: `${anomalyCountInWindow} pricing anomalies recorded for this professional within the detection window (threshold ${REPEATED_PRICING_ANOMALY_THRESHOLD}).`,
  };
}
