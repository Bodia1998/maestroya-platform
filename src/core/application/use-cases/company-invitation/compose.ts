import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyInvitationRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-invitation-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { AcceptCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/accept-company-invitation.use-case";
import { CancelCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/cancel-company-invitation.use-case";
import { CreateCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/create-company-invitation.use-case";
import { DeclineCompanyInvitationUseCase } from "@/application/use-cases/company-invitation/decline-company-invitation.use-case";
import { ListCompanyInvitationsUseCase } from "@/application/use-cases/company-invitation/list-company-invitations.use-case";

const invitations = new PrismaCompanyInvitationRepository();
const memberships = new PrismaCompanyMembershipRepository();
const users = new PrismaUserRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const notifications = new NotificationServiceCreator();

export function makeCreateCompanyInvitationUseCase() {
  return new CreateCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
}

export function makeListCompanyInvitationsUseCase() {
  return new ListCompanyInvitationsUseCase(invitations, memberships);
}

export function makeCancelCompanyInvitationUseCase() {
  return new CancelCompanyInvitationUseCase(invitations, memberships, auditLog);
}

export function makeAcceptCompanyInvitationUseCase() {
  return new AcceptCompanyInvitationUseCase(invitations, memberships, users, auditLog, notifications);
}

export function makeDeclineCompanyInvitationUseCase() {
  return new DeclineCompanyInvitationUseCase(invitations, users, auditLog, notifications);
}
