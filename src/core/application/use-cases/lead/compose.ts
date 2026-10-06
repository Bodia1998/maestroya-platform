import { geocodingProvider } from "@/application/use-cases/geolocation/compose";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaLeadFeedRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-feed-repository";
import { PrismaLeadPreviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-preview-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaTransactionFlowReader } from "@/infrastructure/database/prisma/repositories/prisma-transaction-flow-reader";
import { CreateLeadUseCase } from "@/application/use-cases/lead/create-lead.use-case";
import { CreateLeadV1ServiceRequestUseCase } from "@/application/use-cases/lead/create-lead-v1-service-request.use-case";
import { GetLeadFeedForProfessionalUseCase } from "@/application/use-cases/lead/get-lead-feed.use-case";
import {
  GetPublishedLeadPreviewUseCase,
  GetPublishedLeadPreviewsForProfessionalUseCase,
} from "@/application/use-cases/lead/get-published-lead-previews.use-case";
export { makePublishLeadUseCase } from "@/application/use-cases/lead-publication/compose";

/**
 * Module 125 — Lead Marketplace composition root (same plain-factory
 * convention as service-request/compose.ts and quotes/compose.ts). This is
 * the only place the Module 124 lead use cases are wired to Prisma; entry
 * points (Server Actions) call these factories and nothing else.
 */
const serviceRequests = new PrismaServiceRequestRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const categories = new PrismaServiceCategoryRepository();
const flows = new PrismaTransactionFlowReader();
const leads = new PrismaLeadRepository();
const leadPreviews = new PrismaLeadPreviewRepository();
const leadFeed = new PrismaLeadFeedRepository();
const professionals = new PrismaProfessionalRepository();
const professionalDiscovery = new PrismaProfessionalDiscoveryRepository();

export function makeCreateLeadUseCase() {
  return new CreateLeadUseCase(customerProfiles, serviceRequests, flows, leads);
}

export function makeCreateLeadV1ServiceRequestUseCase() {
  return new CreateLeadV1ServiceRequestUseCase(
    serviceRequests,
    customerProfiles,
    categories,
    geocodingProvider,
    makeCreateLeadUseCase(),
  );
}

export function makeGetPublishedLeadPreviewsForProfessionalUseCase() {
  return new GetPublishedLeadPreviewsForProfessionalUseCase(professionals, professionalDiscovery, leadPreviews);
}

export function makeGetPublishedLeadPreviewUseCase() {
  return new GetPublishedLeadPreviewUseCase(professionals, professionalDiscovery, leadPreviews);
}

/** Module 134 — LEAD_V1 Lead Feed v2 (paginated, snapshot-priced, contact-safe). */
export function makeGetLeadFeedForProfessionalUseCase() {
  return new GetLeadFeedForProfessionalUseCase(professionals, professionalDiscovery, leadFeed);
}
