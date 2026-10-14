import {
  RegionalCalibrationConfigurationError,
  validateRegionalCalibrationConfig,
  type RegionalCalibrationResolution,
} from "@/domain/services/lead-regional-calibration";
import { LEAD_REGIONAL_PRICING_VERSION_ENV } from "@/domain/services/lead-regional-pricing-mode";
import { LEAD_REGIONAL_CALIBRATION_V1 } from "@/infrastructure/pricing/lead-regional-calibration.v1";

/**
 * Module 164 — resolves WHICH regional calibration release runs. Same convention as the Module 132 resolver: reviewed, versioned
 * data lives in the repository; the environment only SELECTS a released snapshot, read by the loader and passed in. There is
 * deliberately no default: an unset or unknown selector is a hard failure, never "use v1".
 */
export const LEAD_REGIONAL_CALIBRATION_CONFIGS: Readonly<Record<string, unknown>> = Object.freeze({
  [LEAD_REGIONAL_CALIBRATION_V1.calibrationVersion]: LEAD_REGIONAL_CALIBRATION_V1,
});

export function resolveRegionalCalibration(
  selector: string | null | undefined,
  registry: Readonly<Record<string, unknown>> = LEAD_REGIONAL_CALIBRATION_CONFIGS,
): RegionalCalibrationResolution {
  const version = typeof selector === "string" ? selector.trim() : "";
  if (version === "") {
    return { status: "INCOMPLETE", issues: [{ path: LEAD_REGIONAL_PRICING_VERSION_ENV, code: "MISSING", message: `not set; choose one of: ${Object.keys(registry).join(", ")}` }] };
  }
  if (!Object.prototype.hasOwnProperty.call(registry, version)) {
    return {
      status: "INVALID",
      issues: [{ path: LEAD_REGIONAL_PRICING_VERSION_ENV, code: "INVALID", message: `unknown version ${JSON.stringify(version)}; known versions: ${Object.keys(registry).join(", ")}` }],
    };
  }
  const resolution = validateRegionalCalibrationConfig(registry[version]);
  if (resolution.status === "VALID" && resolution.config.calibrationVersion !== version) {
    return { status: "INVALID", issues: [{ path: "calibrationVersion", code: "INVALID", message: "registry key does not match the snapshot's calibrationVersion" }] };
  }
  return resolution;
}

export function loadRegionalCalibrationOrThrow(selector: string | null | undefined, registry?: Readonly<Record<string, unknown>>) {
  const resolution = resolveRegionalCalibration(selector, registry);
  if (resolution.status !== "VALID") throw new RegionalCalibrationConfigurationError(resolution.status, resolution.issues);
  return resolution.config;
}
