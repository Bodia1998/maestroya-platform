import { PrismaCustomerAnalyticsRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-analytics-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaFinancialReportingRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-reporting-repository";
import { PrismaPlatformAnalyticsRepository } from "@/infrastructure/database/prisma/repositories/prisma-platform-analytics-repository";
import { PrismaProfessionalAnalyticsRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-analytics-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaReviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-review-repository";
import { makeGetPlatformRevenueSummaryUseCase, makeGetProfessionalEarningsUseCase } from "@/application/use-cases/financial/compose";
import { GetCustomerAnalyticsSummaryUseCase } from "./get-customer-analytics-summary.use-case";
import { GetPlatformAnalyticsSummaryUseCase } from "./get-platform-analytics-summary.use-case";
import { GetPlatformCategoryBreakdownUseCase } from "./get-platform-category-breakdown.use-case";
import { GetPlatformFunnelUseCase } from "./get-platform-funnel.use-case";
import { GetPlatformGeoBreakdownUseCase } from "./get-platform-geo-breakdown.use-case";
import { GetPlatformRequestsTimeSeriesUseCase } from "./get-platform-requests-timeseries.use-case";
import { GetProfessionalAnalyticsSummaryUseCase } from "./get-professional-analytics-summary.use-case";

/**
 * Module 23 — Analytics: composition root, same convention as every other
 * module's `use-cases/<module>/compose.ts` (see financial/compose.ts).
 * Repositories are cheap singletons; use cases are constructed fresh (or
 * reused where stateless) per factory call.
 */

const platformAnalytics = new PrismaPlatformAnalyticsRepository();
const professionalAnalytics = new PrismaProfessionalAnalyticsRepository();
const customerAnalytics = new PrismaCustomerAnalyticsRepository();
const professionals = new PrismaProfessionalRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const reviews = new PrismaReviewRepository();
const financialReporting = new PrismaFinancialReportingRepository();

export function makeGetPlatformAnalyticsSummaryUseCase() {
  return new GetPlatformAnalyticsSummaryUseCase(platformAnalytics, makeGetPlatformRevenueSummaryUseCase());
}

export function makeGetPlatformRequestsTimeSeriesUseCase() {
  return new GetPlatformRequestsTimeSeriesUseCase(platformAnalytics);
}

export function makeGetPlatformCategoryBreakdownUseCase() {
  return new GetPlatformCategoryBreakdownUseCase(platformAnalytics);
}

export function makeGetPlatformGeoBreakdownUseCase() {
  return new GetPlatformGeoBreakdownUseCase(platformAnalytics);
}

export function makeGetPlatformFunnelUseCase() {
  return new GetPlatformFunnelUseCase(platformAnalytics);
}

export function makeGetProfessionalAnalyticsSummaryUseCase() {
  return new GetProfessionalAnalyticsSummaryUseCase(
    professionals,
    professionalAnalytics,
    reviews,
    makeGetProfessionalEarningsUseCase(),
  );
}

export function makeGetCustomerAnalyticsSummaryUseCase() {
  return new GetCustomerAnalyticsSummaryUseCase(customerProfiles, customerAnalytics, financialReporting);
}
