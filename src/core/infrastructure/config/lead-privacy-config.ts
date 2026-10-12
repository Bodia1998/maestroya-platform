import { parseLeadPrivacyConfig, type ParsedLeadPrivacyConfig } from "@/domain/services/lead-privacy";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 158 — reads the LEAD_V1 privacy policy from the process environment on EVERY call (same convention as the Module 156 abuse
 * configuration), so a change needs no more than the next request. Unconfigured is a valid, safe state: no consent gate beyond
 * withdrawal / erasure, and no period-based minimization. Configured values are never logged; only fixed notes about ignored ones.
 */
export function loadLeadPrivacyConfig(source: Readonly<Record<string, string | undefined>> = process.env): ParsedLeadPrivacyConfig {
  const parsed = parseLeadPrivacyConfig(source);
  if (parsed.warnings.length > 0) logger.warn("lead_privacy.config_values_ignored", { count: parsed.warnings.length, notes: parsed.warnings });
  return parsed;
}
