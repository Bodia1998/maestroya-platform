import { parseLeadAbuseControlConfig, type LeadAbuseControlConfig } from "@/domain/services/lead-abuse-controls";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 156 — reads the lead abuse-control configuration from the process environment on EVERY call (like the M155 evidence
 * switch), so flipping the mode needs a restart of nothing but the next request on a serverless runtime and is the rollout /
 * rollback lever:
 *
 *   LEAD_ABUSE_CONTROL_MODE = OFF (default) | SHADOW | FLAG | ENFORCE      (exact, case-sensitive; anything else = OFF)
 *   LEAD_ABUSE_<RULE>_FLAG_AT / LEAD_ABUSE_<RULE>_BLOCK_AT                  (optional integer overrides in [2, 10000])
 *
 * Invalid overrides are ignored (the released default stays) and logged once per load; the values themselves are never logged.
 */
export function loadLeadAbuseControlConfig(source: Readonly<Record<string, string | undefined>> = process.env): LeadAbuseControlConfig {
  const { config, warnings } = parseLeadAbuseControlConfig(source);
  if (warnings.length > 0) logger.warn("lead_abuse.config_overrides_ignored", { count: warnings.length, notes: warnings });
  return config;
}
