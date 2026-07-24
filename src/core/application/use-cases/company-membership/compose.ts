import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { ChangeCompanyMemberRoleUseCase } from "@/application/use-cases/company-membership/change-company-member-role.use-case";
import { ListCompanyMembersUseCase } from "@/application/use-cases/company-membership/list-company-members.use-case";
import { RemoveCompanyMemberUseCase } from "@/application/use-cases/company-membership/remove-company-member.use-case";
import { TransferCompanyOwnershipUseCase } from "@/application/use-cases/company-membership/transfer-company-ownership.use-case";

const companies = new PrismaCompanyRepository();
const memberships = new PrismaCompanyMembershipRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const notifications = new NotificationServiceCreator();

export function makeListCompanyMembersUseCase() {
  return new ListCompanyMembersUseCase(memberships);
}

export function makeChangeCompanyMemberRoleUseCase() {
  return new ChangeCompanyMemberRoleUseCase(memberships, auditLog, notifications);
}

export function makeRemoveCompanyMemberUseCase() {
  return new RemoveCompanyMemberUseCase(memberships, auditLog, notifications);
}

export function makeTransferCompanyOwnershipUseCase() {
  return new TransferCompanyOwnershipUseCase(companies, memberships, auditLog, notifications);
}
