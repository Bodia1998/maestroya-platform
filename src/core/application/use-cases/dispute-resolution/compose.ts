import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaDisputeResolutionDecisionRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-resolution-decision-repository";
import { PrismaFinancialAdjustmentRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-adjustment-repository";
import { PrismaFinancialLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-ledger-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { eventBus } from "@/infrastructure/events/compose";
import { DisputeFinancialOutcomeDetermined } from "@/domain/events/dispute-financial-outcome-determined";
import { RecordDisputeFinancialOutcomeAuditLogSubscriber } from "@/application/use-cases/dispute-resolution/record-dispute-financial-outcome-audit-log.subscriber";
import { ResolveDisputeWithFinancialOutcomeUseCase } from "@/application/use-cases/dispute-resolution/resolve-dispute-with-financial-outcome.use-case";
import { ResolveDisputeUseCase } from "@/application/use-cases/dispute/resolve-dispute.use-case";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";

/**
 * Module 68 — Dispute Resolution & Financial Protection: composition root.
 * Follows the codebase's established "each compose.ts owns its own
 * cross-module Prisma repository instances" convention (see
 * financial/compose.ts's own doc comment on its `completionConfirmations`)
 * — this file constructs its own `disputes`/`payments`/etc. instances
 * rather than importing dispute/compose.ts's or financial/compose.ts's,
 * even though they'd be structurally identical, to keep every feature's
 * compose.ts independently readable and to avoid import cycles between
 * dispute/compose.ts (which now also needs a
 * DisputeResolutionDecisionRepository for CloseDisputeUseCase's guard) and
 * this one.
 *
 * `ResolveDisputeUseCase` and `CreateFinancialAdjustmentUseCase` ARE reused
 * directly (not reconstructed) — this module orchestrates them, it does
 * not duplicate their logic. Both are cheap, stateless, side-effect-free
 * to construct (matches how every other compose.ts already treats reused
 * use cases, e.g. `DisputeJobCompletionUseCase`'s own
 * `CreateDisputeUseCase`/`EvaluatePaymentReleaseUseCase` dependencies in
 * job/compose.ts).
 */
const disputes = new PrismaDisputeRepository();
const jobs = new PrismaJobRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const companyMembers = new PrismaCompanyMembershipRepository();
const payments = new PrismaPaymentRepository();
const decisions = new PrismaDisputeResolutionDecisionRepository();
const adjustments = new PrismaFinancialAdjustmentRepository();
const ledger = new PrismaFinancialLedgerRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const failureReporter = createFailureReporter();

eventBus.subscribe(DisputeFinancialOutcomeDetermined, new RecordDisputeFinancialOutcomeAuditLogSubscriber(auditLog));

function makeResolveDisputeUseCase() {
  return new ResolveDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, eventBus, failureReporter);
}

function makeCreateFinancialAdjustmentUseCase() {
  return new CreateFinancialAdjustmentUseCase(jobs, adjustments, ledger, payments);
}

export function makeResolveDisputeWithFinancialOutcomeUseCase() {
  return new ResolveDisputeWithFinancialOutcomeUseCase(
    disputes,
    payments,
    decisions,
    makeResolveDisputeUseCase(),
    makeCreateFinancialAdjustmentUseCase(),
    eventBus,
    failureReporter,
  );
}
