import { ConfiguredLeadPurchasePriceProvider } from "@/application/services/lead-pricing/configured-lead-purchase-price-provider";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { PrismaLeadPreviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-preview-repository";
import { PrismaLeadPricingContextReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-pricing-context-reader";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { LEAD_PRICING_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-config.v1";

/**
 * Module 128 — Lead purchase composition root (same plain-factory convention
 * as lead/compose.ts). Wires the concrete price provider into
 * InitiateLeadPurchaseUseCase. No Server Action or route exposes it yet:
 * the purchase entry point (and payment) are later modules.
 */
export function makeLeadPurchasePriceProvider() {
  return new ConfiguredLeadPurchasePriceProvider(new PrismaLeadPricingContextReader(), LEAD_PRICING_CONFIG_V1);
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
