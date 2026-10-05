import type { LeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";
import { JOB_VALUE_ESTIMATION_CONFIG_V1 } from "@/infrastructure/pricing/job-value-estimation-config.v1";
import { LEAD_PRICING_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-config.v1";

/**
 * Module 132 — TEST-ONLY pricing configuration.
 *
 * Built from the Module 128/129 provisional fixtures (MEDIUM minimum
 * confidence, so every V1 estimate stays UNPRICED). Lives under tests/ on
 * purpose: production code (src/) must never import it, which a boundary
 * contract test enforces. It carries `profile: "TEST_ONLY"`, so even if it
 * were selected by name the production loader rejects it.
 */
const { reformas: _reformas, ...rateWithoutReformas } = LEAD_PRICING_CONFIG_V1.rateBySlug;

export const LEAD_PRICING_TEST_CONFIG: LeadPricingProductionConfig = {
  configVersion: "lead-pricing-test-fixture",
  profile: "TEST_ONLY",
  currency: "EUR",
  pilotCategorySlugs: ["montaje-de-muebles", "pintura", "fontaneria", "electricidad", "aire-acondicionado"],
  jobValue: JOB_VALUE_ESTIMATION_CONFIG_V1,
  leadPricing: { ...LEAD_PRICING_CONFIG_V1, rateBySlug: rateWithoutReformas, unsupportedCategorySlugs: ["reformas"] },
};
