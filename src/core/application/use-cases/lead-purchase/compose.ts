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
import { JOB_VALUE_ESTIMATION_CONFIG_V1 } from "@/infrastructure/pricing/job-value-estimation-config.v1";
import { LEAD_PRICING_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-config.v1";

/**
 * Module 128 — Lead purchase composition root (same plain-factory convention
 * as lead/compose.ts). Wires the concrete price provider into
 * InitiateLeadPurchaseUseCase. No Server Action or route exposes it yet:
 * the purchase entry point (and payment) are later modules.
 */
export function makeLeadPurchasePriceProvider() {
  // Module 129: the pricing context now gets its service-value estimate from Job Value Estimation.
  const contexts = new EstimatedValueLeadPricingContextReader(new PrismaJobValueEstimationContextReader(), JOB_VALUE_ESTIMATION_CONFIG_V1);
  return new ConfiguredLeadPurchasePriceProvider(contexts, LEAD_PRICING_CONFIG_V1);
}

export function makeInitiateLeadPurchaseUseCase() {
  return new InitiateLeadPurchaseUseCase(
    new PrismaProfessionalRepository(),
    new PrismaProfessionalDiscoveryRepository(),
    new PrismaLeadRepository(),
    new PrismaServiceRequestRepository(),
    new PrismaLeadPreviewRepository(),
    new PrismaLeadPurchaseRepository(),
    makeLeadPurchasePriceProvider(),
  );
}
