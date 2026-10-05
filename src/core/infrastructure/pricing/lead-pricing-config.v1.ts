import type { LeadPricingConfig } from "@/domain/services/lead-pricing";

/**
 * Module 128 — V1 Lead pricing configuration. DATA ONLY.
 *
 * EVERY VALUE HERE IS PROVISIONAL: preliminary business assumptions, not
 * legally or commercially finalized. Change values here (and bump
 * `ruleVersion`); the algorithm in domain/services/lead-pricing.ts does not
 * change. Rates are keyed by ServiceCategory.slug (the stable seeded key;
 * ids are generated per environment), so categories are not duplicated by
 * id or display name. Only categories that exist in the seed have a rate;
 * any other category is UNPRICED rather than guessed. A subcategory slug
 * entry (none yet) would override its parent; otherwise the parent's rate is
 * used with MEDIUM confidence.
 *
 * Min/max are development defaults, not a commercial decision. The maximum
 * is the large-project protection (a EUR 50,000 job can never cost more than
 * `maximumPrice`).
 *
 * Neutral by design: urgency factors are all 1.0 (the request has an
 * urgency, but no commercial decision exists on how it should move the
 * price). Complexity, lead quality and market/region factors are fixed 1.0
 * in the engine until their modules exist.
 */
export const LEAD_PRICING_CONFIG_V1: LeadPricingConfig = {
  ruleVersion: "lead-pricing-v1-provisional.1",
  rateBySlug: {
    "montaje-de-muebles": "0.10",
    pintura: "0.10",
    fontaneria: "0.12",
    electricidad: "0.12",
    "aire-acondicionado": "0.13",
    reformas: "0.15",
  },
  minimumPrice: "5.00",
  maximumPrice: "150.00",
  urgencyFactors: { LOW: "1.0", MEDIUM: "1.0", HIGH: "1.0", EMERGENCY: "1.0" },
  minimumConfidence: "MEDIUM",
};
