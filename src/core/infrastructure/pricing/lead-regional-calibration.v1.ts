import type { RegionalCalibrationConfig } from "@/domain/services/lead-regional-calibration";

/**
 * Module 164 — REGIONAL / CATEGORY CALIBRATION, release v1. DATA ONLY.
 *
 * THIS RELEASE ENABLES NOTHING. `entries` is EMPTY on purpose: there is no approved, evidence-backed job-value range for any
 * (category, province) combination, so no combination may be priced automatically. With this release selected and the pipeline
 * in ENFORCE mode, every supported-territory request is routed to administrator review (CALIBRATION_MISSING) — it never
 * receives an invented price, and it never falls back to another region, another category or the M132 pilot numbers.
 *
 * The pilot job values in `lead-pricing-pilot-config.v1.ts` are PILOT ASSUMPTIONS (M132) and are deliberately NOT copied here:
 * an assumption is not calibration evidence.
 *
 * What is decided (owner, M164):
 *   D1  territory: mainland Spain + Balearic Islands (enforced by domain/services/spain-pricing-territory.ts; an entry for any
 *       other province makes this file INVALID).
 *   D3  lead price = 10% of the average estimated job value, floor EUR 20.00, ceiling EUR 400.00, excluding IVA (enforced by
 *       the configuration contract: `baseRate` must be exactly 0.10, the band can only be narrowed).
 *   D4  confidence threshold 7/10 as the TARGET for automatic publication. Its calibration against real outcomes is NOT done.
 *
 * What is NOT decided and therefore NOT enabled:
 *   - any category x province entry (needs approved parameters + evidence; see docs/MODULE_164_REGIONAL_CALIBRATED_PRICING.md);
 *   - the supply multiplier (no approved bounds, no approved computation rule) -> DISABLED, i.e. neutral 1.0;
 *   - the numeric confidence-policy values below other than the 7/10 target and the 0.90 bar: they are ENGINEERING DEFAULTS that
 *     parameterise how the score is earned; they influence no price while `entries` is empty.
 *
 * `maximumJobValue` carries the existing M129/M132 pilot ceiling (EUR 2000.00): a request above it is a large project and is
 * not priced here (never clamped). `reformas` stays unsupported, as in M132.
 *
 * Never edit a released snapshot in place: a change is a NEW `calibrationVersion` so every priced lead stays attributable.
 */
export const LEAD_REGIONAL_CALIBRATION_V1: RegionalCalibrationConfig = {
  calibrationVersion: "lead-regional-pricing-v1",
  jobValueRuleVersion: "regional-job-value-v1",
  pricingRuleVersion: "lead-pricing-regional-v1",
  currency: "EUR",
  baseRate: "0.10",
  minimumPrice: "20.00",
  maximumPrice: "400.00",
  maximumJobValue: "2000.00",
  unsupportedCategorySlugs: ["reformas"],
  confidencePolicy: {
    autoPublishMinimumScore: 7,
    narrowSpreadMax: "0.20",
    moderateSpreadMax: "0.40",
    minimumValidationSample: 100,
    minimumValidationRate: "0.90",
  },
  supplyMultiplier: { status: "DISABLED" },
  entries: [],
};
