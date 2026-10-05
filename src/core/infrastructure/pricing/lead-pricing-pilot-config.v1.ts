import type { LeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";

/**
 * Module 132 — LEAD_V1 PILOT pricing configuration (production profile). DATA ONLY.
 *
 * This is the snapshot an operator selects with `LEAD_PRICING_CONFIG_VERSION=
 * lead-pricing-pilot-v1`. It is the ONLY configuration production composition
 * can run; there is no default and no fallback to the Module 128/129
 * "provisional" fixtures.
 *
 * Pilot categories = the categories that already exist in the seed
 * (prisma/seed.ts), keyed by ServiceCategory.slug. No new taxonomy.
 *   supported : fontaneria, electricidad, aire-acondicionado, pintura, montaje-de-muebles
 *   unsupported: reformas — large/variable projects with no structured scope, so
 *                there is no defensible typical job value. It is listed explicitly
 *                and is reported CATEGORY_UNSUPPORTED instead of being guessed.
 * Child categories (fontanero, pintor, …) are priced through their parent's entry.
 *
 * Why `minimumConfidence: "LOW"` (an explicit pilot decision, see the M132 report):
 * V1 has no structured job scope, so every estimate is LOW confidence by design
 * (Module 129). With the previous MEDIUM requirement NO seeded category could ever
 * be priced. For the pilot the lead price is accepted at LOW confidence because it
 * is bounded: minimumPrice/maximumPrice clamp it to 5.00–150.00 EUR whatever the
 * estimate, and it is a platform access fee, not what the customer pays.
 *
 * Every number is a PILOT ASSUMPTION carried over from the Module 128/129
 * provisional values, not a commercially validated price list. Changing any value
 * requires a NEW `configVersion` + ruleVersions (never edit a released snapshot
 * in place), so every priced lead stays attributable to the rules that priced it.
 *
 * Urgency factors are neutral (1.0): no commercial decision exists on urgency.
 */
export const LEAD_PRICING_PILOT_CONFIG_V1: LeadPricingProductionConfig = {
  configVersion: "lead-pricing-pilot-v1",
  profile: "PILOT_PRODUCTION",
  currency: "EUR",
  pilotCategorySlugs: ["fontaneria", "electricidad", "aire-acondicionado", "pintura", "montaje-de-muebles"],
  jobValue: {
    ruleVersion: "job-value-pilot-v1.1",
    baseValueBySlug: {
      "montaje-de-muebles": "90.00",
      pintura: "350.00",
      fontaneria: "150.00",
      electricidad: "150.00",
      "aire-acondicionado": "400.00",
    },
    urgencyFactors: { LOW: "1.0", MEDIUM: "1.0", HIGH: "1.0", EMERGENCY: "1.0" },
    maximumValue: "2000.00",
  },
  leadPricing: {
    ruleVersion: "lead-pricing-pilot-v1.1",
    rateBySlug: {
      "montaje-de-muebles": "0.10",
      pintura: "0.10",
      fontaneria: "0.12",
      electricidad: "0.12",
      "aire-acondicionado": "0.13",
    },
    minimumPrice: "5.00",
    maximumPrice: "150.00",
    urgencyFactors: { LOW: "1.0", MEDIUM: "1.0", HIGH: "1.0", EMERGENCY: "1.0" },
    minimumConfidence: "LOW",
    unsupportedCategorySlugs: ["reformas"],
  },
};
