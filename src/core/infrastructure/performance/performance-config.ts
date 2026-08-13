import "server-only";

import type { RegressionThresholds } from "@/domain/entities/performance-regression";
import { CAPACITY_USER_TIERS, type CapacityUserTier } from "@/domain/entities/capacity-report";
import { env } from "@/infrastructure/config/env";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Turns the validated `LOAD_TEST_*` environment variables into the
 * resolved shapes the rest of this module reads — the same "decide once,
 * from the validated env, in a single named place" role
 * `resolveBackupConfig()` plays for Module 54. Kept separate from
 * `compose.ts` so "is load testing enabled, and with what thresholds?" is
 * unit-testable without constructing an executor or a repository.
 */
export interface PerformanceConfig {
  enabled: boolean;
  defaultSeed: number;
  regressionThresholds: RegressionThresholds;
  capacityTiers: readonly CapacityUserTier[];
}

export function resolvePerformanceConfig(): PerformanceConfig {
  return {
    enabled: env.LOAD_TEST_ENABLED === "true",
    defaultSeed: env.LOAD_TEST_DEFAULT_SEED,
    regressionThresholds: {
      minorPercent: env.LOAD_TEST_REGRESSION_MINOR_PERCENT,
      moderatePercent: env.LOAD_TEST_REGRESSION_MODERATE_PERCENT,
      severePercent: env.LOAD_TEST_REGRESSION_SEVERE_PERCENT,
      criticalPercent: env.LOAD_TEST_REGRESSION_CRITICAL_PERCENT,
    },
    capacityTiers: CAPACITY_USER_TIERS,
  };
}
