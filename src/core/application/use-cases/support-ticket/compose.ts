import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaSupportTicketRepository } from "@/infrastructure/database/prisma/repositories/prisma-support-ticket-repository";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { eventBus } from "@/infrastructure/events/compose";
// Side-effect import: registers NotifySupportTicketStatusChangeSubscriber
// against the shared eventBus. Mirrors verification/compose.ts's own
// identical import of notification/compose.ts — see that file's doc
// comment for why this is imported here rather than relying solely on
// instrumentation.ts.
import "@/application/use-cases/notification/compose";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import { RecordSupportTicketAuditLogSubscriber } from "@/application/use-cases/support-ticket/record-support-ticket-audit-log.subscriber";
import { AssignSupportTicketUseCase } from "@/application/use-cases/support-ticket/assign-support-ticket.use-case";
import { ChangeSupportTicketStatusUseCase } from "@/application/use-cases/support-ticket/change-support-ticket-status.use-case";
import { CloseSupportTicketUseCase } from "@/application/use-cases/support-ticket/close-support-ticket.use-case";
import { CreateSupportTicketUseCase } from "@/application/use-cases/support-ticket/create-support-ticket.use-case";
import { GetAdminSupportTicketUseCase } from "@/application/use-cases/support-ticket/get-admin-support-ticket.use-case";
import { GetSupportTicketByIdUseCase } from "@/application/use-cases/support-ticket/get-support-ticket-by-id.use-case";
import { ListAdminSupportTicketsUseCase } from "@/application/use-cases/support-ticket/list-admin-support-tickets.use-case";
import { ListMySupportTicketsUseCase } from "@/application/use-cases/support-ticket/list-my-support-tickets.use-case";
import { ResolveSupportTicketUseCase } from "@/application/use-cases/support-ticket/resolve-support-ticket.use-case";

const tickets = new PrismaSupportTicketRepository();
const auditLog = new PrismaAdminAuditLogRepository();
// Module 39 — Sentry + CI/CD Hardening: SentryFailureReporter in
// production, ConsoleFailureReporter (Module 37) otherwise — see
// failure-reporter-factory.ts's own doc comment. No use case or
// subscriber in this module changes.
const failureReporter = createFailureReporter();

/**
 * Module 37 — Domain Event Subscribers: registers this module's
 * `SupportTicketStatusChanged` audit-log subscriber against the shared
 * `eventBus`, at module load time — the exact pattern documented in
 * `infrastructure/events/compose.ts`'s own doc comment and mirrored from
 * `verification/compose.ts`. The sibling notification subscriber is
 * registered the same way from `notification/compose.ts`; neither file
 * imports the other's use cases.
 */
eventBus.subscribe(SupportTicketStatusChanged, new RecordSupportTicketAuditLogSubscriber(auditLog));

export function makeCreateSupportTicketUseCase() {
  return new CreateSupportTicketUseCase(tickets, auditLog);
}

export function makeGetSupportTicketByIdUseCase() {
  return new GetSupportTicketByIdUseCase(tickets);
}

export function makeGetAdminSupportTicketUseCase() {
  return new GetAdminSupportTicketUseCase(tickets);
}

export function makeListMySupportTicketsUseCase() {
  return new ListMySupportTicketsUseCase(tickets);
}

export function makeListAdminSupportTicketsUseCase() {
  return new ListAdminSupportTicketsUseCase(tickets);
}

export function makeAssignSupportTicketUseCase() {
  return new AssignSupportTicketUseCase(tickets, eventBus, failureReporter);
}

export function makeChangeSupportTicketStatusUseCase() {
  return new ChangeSupportTicketStatusUseCase(tickets, eventBus, failureReporter);
}

export function makeResolveSupportTicketUseCase() {
  return new ResolveSupportTicketUseCase(tickets, eventBus, failureReporter);
}

export function makeCloseSupportTicketUseCase() {
  return new CloseSupportTicketUseCase(tickets, eventBus, failureReporter);
}
