import {
  LEAD_ROLLOUT_MODE_ENV,
  LEAD_ROLLOUT_UNAVAILABLE_CONFIG,
  parseLeadRolloutConfig,
  type LeadRolloutConfig,
} from "@/domain/services/lead-rollout";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 159 — reads the LEAD_V1 rollout switch from the process environment on EVERY call (the M156/M158 convention), so a cached
 * use case, a long-lived server process or a re-used module instance can never act on a stale value.
 *
 *   LEAD_V1_ROLLOUT_MODE = DISABLED (default) | ENTRY_ONLY | PURCHASE_ONLY | ENABLED      (exact, case-sensitive)
 *
 * Unset or empty => DISABLED. Any other value (typo, wrong case, padding, "true") => DISABLED plus a value-free warning. If the
 * environment cannot even be read the result is DISABLED as well: this function never throws and never degrades towards "enabled".
 *
 * Changing the variable still takes effect through the platform's normal mechanism for environment changes (a new deployment or an
 * instance restart); there is no remote configuration service and no database-backed flag (see docs/MODULE_159_ROLLOUT_CONTROLS.md).
 */
export function loadLeadRolloutConfig(source: Readonly<Record<string, string | undefined>> = process.env): LeadRolloutConfig {
  try {
    const config = parseLeadRolloutConfig(source[LEAD_ROLLOUT_MODE_ENV]);
    // The raw value is never logged: it is operator input and may be anything.
    if (config.status === "MISCONFIGURED") logger.warn("lead_rollout.config_invalid", { variable: LEAD_ROLLOUT_MODE_ENV, effectiveMode: config.mode });
    return config;
  } catch (error) {
    try {
      logger.error("lead_rollout.config_unreadable", { error: error instanceof Error ? error.name : "unknown" });
    } catch {
      // Logging must never decide the outcome.
    }
    return LEAD_ROLLOUT_UNAVAILABLE_CONFIG;
  }
}
