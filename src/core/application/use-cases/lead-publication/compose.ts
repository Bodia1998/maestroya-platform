import { ConfiguredLeadPublicationPriceSource } from "@/application/services/lead-pricing/configured-lead-publication-price-source";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";
import type { LeadPricingConfigResolution } from "@/domain/services/lead-pricing-production-config";
import type { LeadBuyerPolicy } from "@/domain/services/lead-publication";
import { env } from "@/infrastructure/config/env";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaJobValueEstimationContextReader } from "@/infrastructure/database/prisma/repositories/prisma-job-value-estimation-context-reader";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { LEAD_BUYER_POLICY_PILOT_V1 } from "@/infrastructure/lead-publication/lead-buyer-policy-pilot.v1";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";

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

export function makePublishLeadUseCase(
  configuration: LeadPricingConfigResolution = resolveLeadPublicationConfiguration(),
  buyerPolicy: LeadBuyerPolicy = LEAD_BUYER_POLICY_PILOT_V1,
) {
  return new PublishLeadUseCase(
    new PrismaCustomerProfileRepository(),
    new PrismaServiceRequestRepository(),
    new PrismaLeadRepository(),
    new ConfiguredLeadPublicationPriceSource(new PrismaJobValueEstimationContextReader(), configuration),
    buyerPolicy,
  );
}
