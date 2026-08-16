import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaDisputeEvidenceRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-evidence-repository";
import { PrismaDisputeMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-message-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaDisputeResolutionDecisionRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-resolution-decision-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { eventBus } from "@/infrastructure/events/compose";
// Side-effect import: registers the Notify*DisputeSubscriber handlers
// against the shared eventBus. Mirrors verification/compose.ts's own
// identical import of notification/compose.ts — see that file's doc
// comment for why this is imported here rather than relying solely on
// instrumentation.ts.
import "@/application/use-cases/notification/compose";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import { DisputeAssigned } from "@/domain/events/dispute-assigned";
import { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
import { DisputeCreated } from "@/domain/events/dispute-created";
import { RecordDisputeStatusChangeAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-status-change-audit-log.subscriber";
import { RecordDisputeAssignedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-assigned-audit-log.subscriber";
import { RecordDisputeMessageAddedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-message-added-audit-log.subscriber";
import { RecordDisputeCreatedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-created-audit-log.subscriber";
import { AddDisputeEvidenceUseCase } from "@/application/use-cases/dispute/add-dispute-evidence.use-case";
import { AddDisputeInternalNoteUseCase } from "@/application/use-cases/dispute/add-dispute-internal-note.use-case";
import { AddDisputeMessageUseCase } from "@/application/use-cases/dispute/add-dispute-message.use-case";
import { AssignDisputeUseCase } from "@/application/use-cases/dispute/assign-dispute.use-case";
import { ChangeDisputeStatusUseCase } from "@/application/use-cases/dispute/change-dispute-status.use-case";
import { CloseDisputeUseCase } from "@/application/use-cases/dispute/close-dispute.use-case";
import { CreateDisputeUseCase } from "@/application/use-cases/dispute/create-dispute.use-case";
import { GetAdminDisputeUseCase } from "@/application/use-cases/dispute/get-admin-dispute.use-case";
import { GetDisputeByIdUseCase } from "@/application/use-cases/dispute/get-dispute-by-id.use-case";
import { ListAdminDisputesUseCase } from "@/application/use-cases/dispute/list-admin-disputes.use-case";
import { ListDisputesAgainstMeUseCase } from "@/application/use-cases/dispute/list-disputes-against-me.use-case";
import { ListMyDisputesUseCase } from "@/application/use-cases/dispute/list-my-disputes.use-case";
import { RejectDisputeUseCase } from "@/application/use-cases/dispute/reject-dispute.use-case";
import { ResolveDisputeUseCase } from "@/application/use-cases/dispute/resolve-dispute.use-case";
import { SetDisputePriorityUseCase } from "@/application/use-cases/dispute/set-dispute-priority.use-case";

const disputes = new PrismaDisputeRepository();
const disputeMessages = new PrismaDisputeMessageRepository();
const disputeEvidence = new PrismaDisputeEvidenceRepository();
const jobs = new PrismaJobRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const companyMembers = new PrismaCompanyMembershipRepository();
const auditLog = new PrismaAdminAuditLogRepository();
// Module 68 — Dispute Resolution & Financial Protection: the same
// "each compose.ts owns its own cross-module Prisma repository instances"
// convention as financial/compose.ts's own `completionConfirmations` — see
// that file's doc comment. CloseDisputeUseCase's Module 68 guard reads
// from this instance; dispute-resolution/compose.ts constructs its own
// separate instance for the same reason.
const resolutionDecisions = new PrismaDisputeResolutionDecisionRepository();
// Module 39 — Sentry + CI/CD Hardening: SentryFailureReporter in
// production, ConsoleFailureReporter (Module 37) otherwise — see
// failure-reporter-factory.ts's own doc comment. No use case or
// subscriber in this module changes.
const failureReporter = createFailureReporter();

/**
 * Module 37 — Domain Event Subscribers: registers this module's four
 * audit-log subscribers against the shared `eventBus`, at module load
 * time — the exact pattern documented in `infrastructure/events/compose.ts`'s
 * own doc comment and mirrored from `verification/compose.ts`. Each
 * sibling notification subscriber is registered the same way from
 * `notification/compose.ts`; neither file imports the other's use cases.
 */
eventBus.subscribe(DisputeStatusChanged, new RecordDisputeStatusChangeAuditLogSubscriber(auditLog));
eventBus.subscribe(DisputeAssigned, new RecordDisputeAssignedAuditLogSubscriber(auditLog));
eventBus.subscribe(DisputeMessageAdded, new RecordDisputeMessageAddedAuditLogSubscriber(auditLog));
eventBus.subscribe(DisputeCreated, new RecordDisputeCreatedAuditLogSubscriber(auditLog));

export function makeCreateDisputeUseCase() {
  return new CreateDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, eventBus, failureReporter);
}

export function makeGetDisputeByIdUseCase() {
  return new GetDisputeByIdUseCase(
    disputes,
    jobs,
    disputeMessages,
    disputeEvidence,
    customerProfiles,
    professionals,
    companyMembers,
  );
}

export function makeGetAdminDisputeUseCase() {
  return new GetAdminDisputeUseCase(disputes, disputeMessages, disputeEvidence);
}

export function makeListMyDisputesUseCase() {
  return new ListMyDisputesUseCase(disputes);
}

export function makeListDisputesAgainstMeUseCase() {
  return new ListDisputesAgainstMeUseCase(disputes, jobs, professionals, companyMembers);
}

export function makeListAdminDisputesUseCase() {
  return new ListAdminDisputesUseCase(disputes);
}

export function makeAssignDisputeUseCase() {
  return new AssignDisputeUseCase(disputes, eventBus, failureReporter);
}

export function makeSetDisputePriorityUseCase() {
  return new SetDisputePriorityUseCase(disputes, auditLog);
}

export function makeChangeDisputeStatusUseCase() {
  return new ChangeDisputeStatusUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, eventBus, failureReporter);
}

export function makeAddDisputeMessageUseCase() {
  return new AddDisputeMessageUseCase(
    disputes,
    disputeMessages,
    jobs,
    customerProfiles,
    professionals,
    companyMembers,
    eventBus,
    failureReporter,
  );
}

export function makeAddDisputeInternalNoteUseCase() {
  return new AddDisputeInternalNoteUseCase(disputes, disputeMessages, auditLog);
}

export function makeAddDisputeEvidenceUseCase() {
  return new AddDisputeEvidenceUseCase(
    disputes,
    disputeEvidence,
    jobs,
    customerProfiles,
    professionals,
    companyMembers,
    auditLog,
  );
}

export function makeResolveDisputeUseCase() {
  return new ResolveDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, eventBus, failureReporter);
}

export function makeRejectDisputeUseCase() {
  return new RejectDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, eventBus, failureReporter);
}

export function makeCloseDisputeUseCase() {
  return new CloseDisputeUseCase(
    disputes,
    jobs,
    customerProfiles,
    professionals,
    companyMembers,
    resolutionDecisions,
    eventBus,
    failureReporter,
  );
}
