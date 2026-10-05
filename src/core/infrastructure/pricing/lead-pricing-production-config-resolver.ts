import {
  LeadPricingConfigurationError,
  validateLeadPricingProductionConfig,
  type LeadPricingConfigResolution,
  type LeadPricingProductionConfig,
} from "@/domain/services/lead-pricing-production-config";
import { LEAD_PRICING_PILOT_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";

/**
 * Module 132 — resolves WHICH production pricing configuration runs.
 *
 * Convention: like every other module-boundary config here, the values are
 * reviewed, versioned data in the repository; the environment only SELECTS a
 * released snapshot (`LEAD_PRICING_CONFIG_VERSION`, read once via the validated
 * `env`, never here). There is deliberately no default version: an unset or
 * unknown selector is a hard failure, never "use the pilot / provisional values".
 *
 * Only PILOT_PRODUCTION snapshots belong in the registry. Test fixtures live
 * under tests/ and are injected explicitly; this module must never import them.
 */
export const LEAD_PRICING_PRODUCTION_CONFIG_ENV = "LEAD_PRICING_CONFIG_VERSION";

export const LEAD_PRICING_PRODUCTION_CONFIGS: Readonly<Record<string, LeadPricingProductionConfig>> = Object.freeze({
  [LEAD_PRICING_PILOT_CONFIG_V1.configVersion]: LEAD_PRICING_PILOT_CONFIG_V1,
});

export function resolveLeadPricingProductionConfig(
  selector: string | null | undefined,
  registry: Readonly<Record<string, unknown>> = LEAD_PRICING_PRODUCTION_CONFIGS,
): LeadPricingConfigResolution {
  const version = typeof selector === "string" ? selector.trim() : "";
  if (version === "") {
    return {
      status: "INCOMPLETE",
      issues: [
        {
          path: LEAD_PRICING_PRODUCTION_CONFIG_ENV,
          code: "MISSING",
          message: `not set; choose one of: ${Object.keys(registry).join(", ")}`,
        },
      ],
    };
  }
  if (!Object.prototype.hasOwnProperty.call(registry, version)) {
    return {
      status: "INVALID",
      issues: [
        {
          path: LEAD_PRICING_PRODUCTION_CONFIG_ENV,
          code: "INVALID",
          message: `unknown version ${JSON.stringify(version)}; known versions: ${Object.keys(registry).join(", ")}`,
        },
      ],
    };
  }
  const resolution = validateLeadPricingProductionConfig(registry[version]);
  if (resolution.status === "VALID" && resolution.config.configVersion !== version) {
    return {
      status: "INVALID",
      issues: [{ path: "configVersion", code: "INVALID", message: `registry key ${JSON.stringify(version)} does not match the snapshot's configVersion` }],
    };
  }
  return resolution;
}

/** Fail-closed variant used by composition: returns a validated frozen snapshot or throws with every issue. */
export function loadLeadPricingProductionConfigOrThrow(
  selector: string | null | undefined,
  registry?: Readonly<Record<string, unknown>>,
): LeadPricingProductionConfig {
  const resolution = resolveLeadPricingProductionConfig(selector, registry);
  if (resolution.status !== "VALID") throw new LeadPricingConfigurationError(resolution.status, resolution.issues);
  return resolution.config;
}
