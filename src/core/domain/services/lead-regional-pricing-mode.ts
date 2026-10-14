/**
 * Module 164 — ROLLOUT SWITCH of the regional / calibrated pricing pipeline. Pure; the environment is read by the infrastructure
 * loader (infrastructure/config/lead-regional-pricing-config.ts), never here.
 *
 *   LEAD_REGIONAL_PRICING_MODE = OFF (default) | SHADOW | ENFORCE        (exact, case-sensitive; no trimming, no aliases)
 *
 * OFF      the Module 132 / 163 pipeline prices leads exactly as before M164. The new pipeline is not consulted at all.
 * SHADOW   the Module 132 / 163 pipeline still decides (so no customer-visible or financial behaviour changes), and the
 *          calibrated pipeline is also run, best-effort, with its decision logged for comparison. It writes nothing and can
 *          never block, delay-fail or alter a publication.
 * ENFORCE  the calibrated pipeline decides. Requires a valid `LEAD_REGIONAL_PRICING_CALIBRATION_VERSION`; otherwise every
 *          publication fails closed (it never falls back to the M132 pipeline).
 *
 * Every failure mode moves towards OFF: unset, empty, a typo, a wrong case or an unreadable environment all mean OFF. ENFORCE
 * is only ever the result of the exact word. This switch is independent of the M159 rollout switch (which still gates whether new
 * LEAD_V1 activity may start at all) and of the M132 pricing-version selector.
 *
 * Switching affects only leads published AFTER the change: a published lead's snapshot is immutable and is never re-priced.
 */
export const LEAD_REGIONAL_PRICING_MODE_ENV = "LEAD_REGIONAL_PRICING_MODE";
export const LEAD_REGIONAL_PRICING_VERSION_ENV = "LEAD_REGIONAL_PRICING_CALIBRATION_VERSION";

export const LEAD_REGIONAL_PRICING_MODES = ["OFF", "SHADOW", "ENFORCE"] as const;
export type LeadRegionalPricingMode = (typeof LEAD_REGIONAL_PRICING_MODES)[number];
export const DEFAULT_LEAD_REGIONAL_PRICING_MODE: LeadRegionalPricingMode = "OFF";

export type LeadRegionalPricingConfigStatus = "DEFAULT" | "CONFIGURED" | "MISCONFIGURED";

export interface LeadRegionalPricingConfig {
  readonly mode: LeadRegionalPricingMode;
  readonly status: LeadRegionalPricingConfigStatus;
  /** The raw calibration-version selector (trimmed), or null. Validity is decided by the resolver, not here. */
  readonly calibrationVersion: string | null;
}

export function parseLeadRegionalPricingConfig(rawMode: unknown, rawVersion: unknown): LeadRegionalPricingConfig {
  const calibrationVersion = typeof rawVersion === "string" && rawVersion.trim() !== "" ? rawVersion.trim() : null;
  if (rawMode === undefined || rawMode === null || rawMode === "") return { mode: DEFAULT_LEAD_REGIONAL_PRICING_MODE, status: "DEFAULT", calibrationVersion };
  if (typeof rawMode === "string" && (LEAD_REGIONAL_PRICING_MODES as readonly string[]).includes(rawMode)) {
    return { mode: rawMode as LeadRegionalPricingMode, status: "CONFIGURED", calibrationVersion };
  }
  return { mode: DEFAULT_LEAD_REGIONAL_PRICING_MODE, status: "MISCONFIGURED", calibrationVersion };
}

/** Used when the environment cannot even be read: OFF. */
export const LEAD_REGIONAL_PRICING_UNAVAILABLE_CONFIG: LeadRegionalPricingConfig = {
  mode: DEFAULT_LEAD_REGIONAL_PRICING_MODE,
  status: "MISCONFIGURED",
  calibrationVersion: null,
};
