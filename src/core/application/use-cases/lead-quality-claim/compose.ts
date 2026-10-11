import { DecideLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/decide-lead-quality-claim.use-case";
import { StartLeadQualityClaimReviewUseCase } from "@/application/use-cases/lead-quality-claim/start-lead-quality-claim-review.use-case";
import { SubmitLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/submit-lead-quality-claim.use-case";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadQualityClaimRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-quality-claim-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";

/**
 * Module 154 (Part A) — composition root of the lead-quality claim workflow (plain factories, no DI container).
 *
 * Nothing in the application calls these today: no route, Server Action, job, webhook, subscriber, notification or admin UI exists
 * for claims. When a caller is added (M157), the submit use case takes the authenticated SESSION user id only; the two
 * administrative use cases re-validate the admin themselves, but a caller should still gate with requireRole(ADMIN, SUPER_ADMIN).
 *
 * The audit entry of every transition is written by the claims repository itself, in the same database transaction as the transition.
 *
 * NO refund integration: nothing here imports the M153 refund use case, a payment gateway or Stripe. A claim decision is not a refund.
 */
const professionals = new PrismaProfessionalRepository();
const purchases = new PrismaLeadPurchaseRepository();
const claims = new PrismaLeadQualityClaimRepository();
const admins = new PrismaAdminRepository();

export function makeSubmitLeadQualityClaimUseCase() {
  return new SubmitLeadQualityClaimUseCase(professionals, purchases, claims);
}

export function makeStartLeadQualityClaimReviewUseCase() {
  return new StartLeadQualityClaimReviewUseCase(admins, claims);
}

export function makeDecideLeadQualityClaimUseCase() {
  return new DecideLeadQualityClaimUseCase(admins, claims);
}
