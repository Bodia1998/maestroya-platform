import { EstimatedValueLeadPricingContextReader } from "@/application/services/lead-pricing/estimated-value-lead-pricing-context-reader";
import { ConfiguredLeadPurchasePriceProvider } from "@/application/services/lead-pricing/configured-lead-purchase-price-provider";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { PrismaLeadPreviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-preview-repository";
import { PrismaJobValueEstimationContextReader } from "@/infrastructure/database/prisma/repositories/prisma-job-value-estimation-context-reader";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { env } from "@/infrastructure/config/env";
import type { LeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";
import { loadLeadPricingProductionConfigOrThrow } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";

/**
 * Module 128 — Lead purchase composition root (same plain-factory convention
 * as lead/compose.ts). Wires the concrete price provider into
 * InitiateLeadPurchaseUseCase. No Server Action or route exposes it yet:
 * the purchase entry point (and payment) are later modules.
 */
/**
 * Module 132: the pricing configuration is now an explicit, validated input.
 * By default it is the production snapshot selected by
 * `LEAD_PRICING_CONFIG_VERSION`; if that is missing, unknown, incomplete or
 * invalid this THROWS LeadPricingConfigurationError (fail closed) — there is no
 * default price and no fallback to the Module 128/129 provisional fixtures.
 * Tests may inject a `config` explicitly.
 */
export function makeLeadPurchasePriceProvider(config: LeadPricingProductionConfig = loadLeadPricingProductionConfigOrThrow(env.LEAD_PRICING_CONFIG_VERSION)) {
  // Module 129: the pricing context gets its service-value estimate from Job Value Estimation.
  const contexts = new EstimatedValueLeadPricingContextReader(new PrismaJobValueEstimationContextReader(), config.jobValue);
  return new ConfiguredLeadPurchasePriceProvider(contexts, config.leadPricing);
}

export function makeInitiateLeadPurchaseUseCase(config?: LeadPricingProductionConfig) {
  return new InitiateLeadPurchaseUseCase(
    new PrismaProfessionalRepository(),
    new PrismaProfessionalDiscoveryRepository(),
    new PrismaLeadRepository(),
    new PrismaServiceRequestRepository(),
    new PrismaLeadPreviewRepository(),
    new PrismaLeadPurchaseRepository(),
    makeLeadPurchasePriceProvider(config),
  );
}
