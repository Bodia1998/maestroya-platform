import { RecordLeadEstimateOutcomeUseCase } from "@/application/use-cases/lead-pricing-review/record-lead-estimate-outcome.use-case";
import {
  DecideLeadPricingReviewUseCase,
  GetLeadPricingReviewUseCase,
  ListLeadPricingReviewsUseCase,
} from "@/application/use-cases/lead-pricing-review/lead-pricing-review.use-cases";
import { loadLeadRegionalPricingConfig } from "@/infrastructure/config/lead-regional-pricing-config";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaLeadEstimateOutcomeRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-estimate-outcome-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaLeadPricingReviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-pricing-review-repository";
import { resolveRegionalCalibration } from "@/infrastructure/pricing/lead-regional-calibration-resolver";

/**
 * Module 164 — composition root of the lead pricing review administrator use cases (plain factories, no DI container).
 *
 * Each factory builds fresh collaborators and reads the calibration selector at call time, like the publication composition,
 * so a decision is always validated against the release the pipeline currently runs.
 */
const admins = new PrismaAdminRepository();
const reviews = new PrismaLeadPricingReviewRepository();

export const makeListLeadPricingReviewsUseCase = () => new ListLeadPricingReviewsUseCase(admins, reviews);
export const makeGetLeadPricingReviewUseCase = () => new GetLeadPricingReviewUseCase(admins, reviews);
export const makeDecideLeadPricingReviewUseCase = () =>
  new DecideLeadPricingReviewUseCase(admins, reviews, resolveRegionalCalibration(loadLeadRegionalPricingConfig().calibrationVersion));
export const makeRecordLeadEstimateOutcomeUseCase = () => new RecordLeadEstimateOutcomeUseCase(admins, new PrismaLeadRepository(), new PrismaLeadEstimateOutcomeRepository());
