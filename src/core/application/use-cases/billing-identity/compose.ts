import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaProfessionalBillingIdentityRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { GetMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/get-my-billing-identity.use-case";
import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import {
  GetBillingIdentityForAdminReviewUseCase,
  ListBillingIdentitiesPendingReviewUseCase,
  RejectBillingIdentityUseCase,
  VerifyBillingIdentityUseCase,
} from "@/application/use-cases/billing-identity/review-billing-identity.use-cases";
import { SaveMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/save-my-billing-identity.use-case";

/**
 * Module 146 — manual composition root for the professional billing identity
 * (plain factories, no DI container, same convention as the other compose.ts files).
 */
const professionals = new PrismaProfessionalRepository();
const identities = new PrismaProfessionalBillingIdentityRepository();
const audit = new PrismaAdminAuditLogRepository();
const failureReporter = createFailureReporter();

/** Professional-facing (session user only). */
export function makeGetMyBillingIdentityUseCase() {
  return new GetMyBillingIdentityUseCase(professionals, identities);
}

export function makeSaveMyBillingIdentityUseCase() {
  return new SaveMyBillingIdentityUseCase(professionals, identities, audit, failureReporter);
}

/** Admin-only: callers MUST gate with requireRole(ADMIN, SUPER_ADMIN). */
export function makeVerifyBillingIdentityUseCase() {
  return new VerifyBillingIdentityUseCase(identities, audit, failureReporter);
}

export function makeRejectBillingIdentityUseCase() {
  return new RejectBillingIdentityUseCase(identities, audit, failureReporter);
}

export function makeGetBillingIdentityForAdminReviewUseCase() {
  return new GetBillingIdentityForAdminReviewUseCase(identities);
}

export function makeListBillingIdentitiesPendingReviewUseCase() {
  return new ListBillingIdentitiesPendingReviewUseCase(identities);
}

/** Trusted-internal (M147 / M150): never expose to the browser. */
export function makeGetProfessionalBillingReadinessUseCase() {
  return new GetProfessionalBillingReadinessUseCase(identities);
}
