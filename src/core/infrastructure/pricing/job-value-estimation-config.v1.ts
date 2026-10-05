import type { JobValueEstimationConfig } from "@/domain/services/job-value-estimation";

/**
 * Module 129 — V1 Job Value Estimation configuration. DATA ONLY.
 *
 * EVERY VALUE HERE IS PROVISIONAL: a preliminary business assumption of the
 * "typical" value of one job in the category, not a market price list and not
 * commercially validated. Change values here (and bump `ruleVersion`); the
 * algorithm in domain/services/job-value-estimation.ts does not change.
 *
 * Keyed by ServiceCategory.slug. Only narrow, small-ticket categories are
 * configured. `reformas` (large/variable projects) is DELIBERATELY absent:
 * without structured scope it is UNAVAILABLE rather than a made-up number.
 * No job-type-level (subcategory) entries exist yet, so V1 estimates are LOW
 * confidence and Module 128 (minimumConfidence MEDIUM) leaves them UNPRICED
 * until structured scope input / job-type entries are introduced.
 *
 * Urgency factors are neutral: no commercial decision exists on how urgency
 * should move the job value (and Module 128 has its own urgency factor).
 */
export const JOB_VALUE_ESTIMATION_CONFIG_V1: JobValueEstimationConfig = {
  ruleVersion: "job-value-v1-provisional.1",
  baseValueBySlug: {
    "montaje-de-muebles": "90.00",
    pintura: "350.00",
    fontaneria: "150.00",
    electricidad: "150.00",
    "aire-acondicionado": "400.00",
  },
  urgencyFactors: { LOW: "1.0", MEDIUM: "1.0", HIGH: "1.0", EMERGENCY: "1.0" },
  maximumValue: "2000.00",
};
