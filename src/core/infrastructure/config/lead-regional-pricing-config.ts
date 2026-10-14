import {
  LEAD_REGIONAL_PRICING_MODE_ENV,
  LEAD_REGIONAL_PRICING_UNAVAILABLE_CONFIG,
  LEAD_REGIONAL_PRICING_VERSION_ENV,
  parseLeadRegionalPricingConfig,
  type LeadRegionalPricingConfig,
} from "@/domain/services/lead-regional-pricing-mode";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 164 — reads the regional-pricing switch and the calibration-version selector from the process environment on EVERY
 * call (the M156/M158/M159 convention), so a cached use case or a long-lived process can never act on a stale value.
 *
 * Never throws and never degrades towards ENFORCE: unset / empty / invalid / unreadable all mean OFF. The raw operator value is
 * never logged.
 */
export function loadLeadRegionalPricingConfig(source: Readonly<Record<string, string | undefined>> = process.env): LeadRegionalPricingConfig {
  try {
    const config = parseLeadRegionalPricingConfig(source[LEAD_REGIONAL_PRICING_MODE_ENV], source[LEAD_REGIONAL_PRICING_VERSION_ENV]);
    if (config.status === "MISCONFIGURED") logger.warn("lead_regional_pricing.config_invalid", { variable: LEAD_REGIONAL_PRICING_MODE_ENV, effectiveMode: config.mode });
    return config;
  } catch (error) {
    try {
      logger.error("lead_regional_pricing.config_unreadable", { error: error instanceof Error ? error.name : "unknown" });
    } catch {
      // Logging must never decide the outcome.
    }
    return LEAD_REGIONAL_PRICING_UNAVAILABLE_CONFIG;
  }
}
