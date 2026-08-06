import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyInvitationRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-invitation-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { ConsoleFailureReporter } from "@/infrastructure/observability/console-failure-reporter";
import { eventBus } from "@/infrastructure/events/compose";
// Side-effect import: registers NotifyCompanyInvitationStatusChangeSubscriber
// against the shared eventBus. Mirrors verification/compose.ts's own
// identical import of notification/compose.ts — see that file's doc
// comment for why this is imported here rather than relying solely on
// instrumentation.ts.
import "@/application/use-cases/notification/compose";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import { RecordCompanyInvitationAuditLogSubscriber } from "@/application/use-cases/company-invitation/record-company-invitation-audit-log.subscriber";
import { AcceptCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/accept-company-invitation.use-case";
import { CancelCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/cancel-company-invitation.use-case";
import { CreateCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/create-company-invitation.use-case";
import { DeclineCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/decline-company-invitation.use-case";
import { ListCompanyInvitationsUseCase } from "@/application/use-cases/company-invitation/list-company-invitations.use-case";

const invitations = new PrismaCompanyInvitationRepository();
const memberships = new PrismaCompanyMembershipRepository();
const users = new PrismaUserRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const failureReporter = new ConsoleFailureReporter();

/**
 * Module 37 — Domain Event Subscribers: registers this module's
 * `CompanyInvitationStatusChanged` audit-log subscriber against the shared
 * `eventBus`, at module load time — the exact pattern documented in
 * `infrastructure/events/compose.ts`'s own doc comment and mirrored from
 * `verification/compose.ts`. The sibling notification subscriber is
 * registered the same way from `notification/compose.ts`; neither file
 * imports the other's use cases.
 */
eventBus.subscribe(CompanyInvitationStatusChanged, new RecordCompanyInvitationAuditLogSubscriber(auditLog));

export function makeCreateCompanyInvitationUseCase() {
  return new CreateCompanyInvitationUseCase(invitations, memberships, users, eventBus, failureReporter);
}

export function makeListCompanyInvitationsUseCase() {
  return new ListCompanyInvitationsUseCase(invitations, memberships);
}

export function makeCancelCompanyInvitationUseCase() {
  return new CancelCompanyInvitationUseCase(invitations, memberships, auditLog);
}

export function makeAcceptCompanyInvitationUseCase() {
  return new AcceptCompanyInvitationUseCase(invitations, memberships, users, eventBus, failureReporter);
}

export function makeDeclineCompanyInvitationUseCase() {
  return new DeclineCompanyInvitationUseCase(invitations, users, eventBus, failureReporter);
}
