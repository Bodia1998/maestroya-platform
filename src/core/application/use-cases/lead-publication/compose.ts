import { CalibratedLeadPublicationPriceSource } from "@/application/services/lead-pricing/calibrated-lead-publication-price-source";
import { ConfiguredLeadPublicationPriceSource } from "@/application/services/lead-pricing/configured-lead-publication-price-source";
import { RegionalPricingModePriceSource } from "@/application/services/lead-pricing/regional-pricing-mode-price-source";
import type { LeadPublicationPriceSource } from "@/application/ports/lead-publication-price-source";
import { guardLeadPublication } from "@/application/use-cases/lead-abuse/compose";
import { guardLeadV1Entry } from "@/application/use-cases/lead-rollout/compose";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";
import type { LeadPricingConfigResolution } from "@/domain/services/lead-pricing-production-config";
import type { LeadBuyerPolicy } from "@/domain/services/lead-publication";
import { env } from "@/infrastructure/config/env";
import { loadLeadRegionalPricingConfig } from "@/infrastructure/config/lead-regional-pricing-config";
import { logger } from "@/infrastructure/observability/logger";
import { PrismaLeadPricingRegionReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-pricing-region-reader";
import { PrismaLeadPricingReviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-pricing-review-repository";
import { resolveRegionalCalibration } from "@/infrastructure/pricing/lead-regional-calibration-resolver";
import { eventBus } from "@/infrastructure/events/compose";
// Side-effect import: registers the Module 145 LEAD_V1 notification subscribers against the shared eventBus.
import "@/application/use-cases/notification/compose";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaJobValueEstimationContextReader } from "@/infrastructure/database/prisma/repositories/prisma-job-value-estimation-context-reader";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { LEAD_BUYER_POLICY_PILOT_V1 } from "@/infrastructure/lead-publication/lead-buyer-policy-pilot.v1";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";
import { makeLeadScopeEstimationSource } from "@/application/use-cases/lead-publication/scope-estimation-source";

/**
 * Module 133 — composition root for Lead publication (re-exported by
 * lead/compose.ts, the single entry used by Server Actions). Kept in its own
 * file because it is the only place the publication contract is wired to the
 * Module 132 pricing configuration and the released buyer policy.
 *
 * Pricing configuration: the Module 132 production snapshot selected by
 * `LEAD_PRICING_CONFIG_VERSION`. It is RESOLVED, not thrown: an unset /
 * unknown / invalid selector makes every publication fail closed with
 * LeadPublicationRejectedError (Lead stays DRAFT, retryable once the
 * configuration is fixed) instead of taking the whole app down. There is no
 * fallback to another or provisional configuration.
 *
 * Buyer policy: the released pilot policy (a PILOT ASSUMPTION, see
 * lead-buyer-policy-pilot.v1.ts). Tests may inject both explicitly.
 */
/**
 * Module 142 — the resolution the publication contract runs on, exposed so the
 * customer request UI can derive its supported-category list from exactly the
 * same source (this file stays the only reader of the version selector).
 */
export function resolveLeadPublicationConfiguration(): LeadPricingConfigResolution {
  return resolveLeadPricingProductionConfig(env.LEAD_PRICING_CONFIG_VERSION);
}

/**
 * Module 164 — the regional / calibrated pipeline as a price source. The switch (`LEAD_REGIONAL_PRICING_MODE`) and the release
 * selector (`LEAD_REGIONAL_PRICING_CALIBRATION_VERSION`) are read on EVERY call, never cached, so a long-lived instance cannot act
 * on a stale value. An unset / unknown / invalid release makes the source report CONFIGURATION_UNAVAILABLE (fail closed); it
 * never falls back to the Module 132 pipeline.
 */
function makeCalibratedPriceSource(reviews: PrismaLeadPricingReviewRepository): LeadPublicationPriceSource {
  return {
    priceForLead: (leadId: string) =>
      new CalibratedLeadPublicationPriceSource(
        new PrismaJobValueEstimationContextReader(),
        new PrismaLeadPricingRegionReader(),
        resolveRegionalCalibration(loadLeadRegionalPricingConfig().calibrationVersion),
        reviews,
        makeLeadScopeEstimationSource(),
      ).priceForLead(leadId),
  };
}

export function makePublishLeadUseCase(
  configuration: LeadPricingConfigResolution = resolveLeadPublicationConfiguration(),
  buyerPolicy: LeadBuyerPolicy = LEAD_BUYER_POLICY_PILOT_V1,
) {
  const reviews = new PrismaLeadPricingReviewRepository();
  // Module 164: OFF (default) -> exactly the Module 132/163 source; SHADOW -> same, plus a logged comparison; ENFORCE -> calibrated.
  const priceSource = new RegionalPricingModePriceSource(
    new ConfiguredLeadPublicationPriceSource(new PrismaJobValueEstimationContextReader(), configuration, makeLeadScopeEstimationSource()),
    makeCalibratedPriceSource(reviews),
    () => loadLeadRegionalPricingConfig().mode,
    (observation) => logger.info("lead_regional_pricing.shadow", { ...observation }),
  );
  // Module 156: guarded only when LEAD_ABUSE_CONTROL_MODE is on; OFF (default) returns the use case itself, unchanged.
  // Module 159: the rollout guard is OUTERMOST, so a refused publication spends no M156 rate-limit budget and records no signal.
  return guardLeadV1Entry(
    guardLeadPublication(
      new PublishLeadUseCase(
        new PrismaCustomerProfileRepository(),
        new PrismaServiceRequestRepository(),
        new PrismaLeadRepository(),
        priceSource,
        buyerPolicy,
        eventBus,
        reviews,
      ),
    ),
  );
}
