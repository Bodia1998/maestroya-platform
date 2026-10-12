import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaLeadContactSharingRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-sharing-repository";
import { PrismaLeadPrivacyRetentionRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-privacy-retention-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { loadLeadPrivacyConfig } from "@/infrastructure/config/lead-privacy-config";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { createDistributedLock } from "@/infrastructure/locking/lock-service-factory";
import { RecordLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/record-lead-contact-sharing.use-case";
import { RunLeadPrivacyRetentionUseCase } from "@/application/use-cases/lead-privacy/run-lead-privacy-retention.use-case";
import { WithdrawLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/withdraw-lead-contact-sharing.use-case";

/**
 * Module 158 — composition root for the LEAD_V1 privacy use cases (same plain-factory convention as lead/compose.ts). The policy is
 * re-read from the environment on every call. Entry points must pass the SESSION user id; nothing else is accepted as identity.
 */
function ownershipDeps() {
  return {
    leads: new PrismaLeadRepository(),
    serviceRequests: new PrismaServiceRequestRepository(),
    customerProfiles: new PrismaCustomerProfileRepository(),
    sharing: new PrismaLeadContactSharingRepository(),
    auditLog: new PrismaAdminAuditLogRepository(),
  };
}

export function makeRecordLeadContactSharingUseCase() {
  return new RecordLeadContactSharingUseCase(ownershipDeps(), loadLeadPrivacyConfig().policy, createFailureReporter());
}

export function makeWithdrawLeadContactSharingUseCase() {
  return new WithdrawLeadContactSharingUseCase(ownershipDeps(), createFailureReporter());
}

export function makeRunLeadPrivacyRetentionUseCase() {
  const { policy } = loadLeadPrivacyConfig();
  return new RunLeadPrivacyRetentionUseCase(
    new PrismaLeadPrivacyRetentionRepository(),
    policy,
    new PrismaAdminAuditLogRepository(),
    createDistributedLock(),
    createFailureReporter(),
  );
}

/** Batch size for the cron entry point (validated, defaulted, bounded). */
export function leadPrivacyRetentionBatchSize(): number {
  return loadLeadPrivacyConfig().batchSize;
}
