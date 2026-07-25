import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaSupportTicketRepository } from "@/infrastructure/database/prisma/repositories/prisma-support-ticket-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
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
const notifications = new NotificationServiceCreator();

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
  return new AssignSupportTicketUseCase(tickets, auditLog, notifications);
}

export function makeChangeSupportTicketStatusUseCase() {
  return new ChangeSupportTicketStatusUseCase(tickets, auditLog, notifications);
}

export function makeResolveSupportTicketUseCase() {
  return new ResolveSupportTicketUseCase(tickets, auditLog, notifications);
}

export function makeCloseSupportTicketUseCase() {
  return new CloseSupportTicketUseCase(tickets, auditLog, notifications);
}
