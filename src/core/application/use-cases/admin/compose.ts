import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { ChangeUserRoleUseCase } from "@/application/use-cases/admin/change-user-role.use-case";
import { ListAdminCompaniesUseCase } from "@/application/use-cases/admin/list-admin-companies.use-case";
import { GetAdminCompanyUseCase } from "@/application/use-cases/admin/get-admin-company.use-case";
import { SuspendCompanyUseCase } from "@/application/use-cases/admin/suspend-company.use-case";
import { ReactivateCompanyUseCase } from "@/application/use-cases/admin/reactivate-company.use-case";
import { GetAdminDashboardOverviewUseCase } from "@/application/use-cases/admin/get-admin-dashboard-overview.use-case";
import { GetAdminJobUseCase } from "@/application/use-cases/admin/get-admin-job.use-case";
import { GetAdminProfessionalUseCase } from "@/application/use-cases/admin/get-admin-professional.use-case";
import { GetAdminQuoteUseCase } from "@/application/use-cases/admin/get-admin-quote.use-case";
import { GetAdminServiceRequestUseCase } from "@/application/use-cases/admin/get-admin-service-request.use-case";
import { GetAdminUserUseCase } from "@/application/use-cases/admin/get-admin-user.use-case";
import { ListAdminAuditLogsUseCase } from "@/application/use-cases/admin/list-admin-audit-logs.use-case";
import { ListAdminJobsUseCase } from "@/application/use-cases/admin/list-admin-jobs.use-case";
import { ListAdminPortfolioItemsUseCase } from "@/application/use-cases/admin/list-admin-portfolio-items.use-case";
import { ListAdminProfessionalsUseCase } from "@/application/use-cases/admin/list-admin-professionals.use-case";
import { ListAdminQuotesUseCase } from "@/application/use-cases/admin/list-admin-quotes.use-case";
import { ListAdminReviewsUseCase } from "@/application/use-cases/admin/list-admin-reviews.use-case";
import { ListAdminServiceRequestsUseCase } from "@/application/use-cases/admin/list-admin-service-requests.use-case";
import { ListAdminUsersUseCase } from "@/application/use-cases/admin/list-admin-users.use-case";
import { ModeratePortfolioItemUseCase } from "@/application/use-cases/admin/moderate-portfolio-item.use-case";
import { ModerateReviewUseCase } from "@/application/use-cases/admin/moderate-review.use-case";
import { ReactivateAdminUserUseCase } from "@/application/use-cases/admin/reactivate-admin-user.use-case";
import { RestorePortfolioItemUseCase } from "@/application/use-cases/admin/restore-portfolio-item.use-case";
import { RestoreReviewUseCase } from "@/application/use-cases/admin/restore-review.use-case";
import { SuspendAdminUserUseCase } from "@/application/use-cases/admin/suspend-admin-user.use-case";

/**
 * Admin Panel module (Module 16): composition root — wires the Prisma
 * implementations to every admin use case, same "one shared repository
 * instance, one factory function per use case" convention as
 * notification/compose.ts and review/compose.ts. Never instantiated
 * directly from a Server Action (see admin/actions.ts).
 */

const admins = new PrismaAdminRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const notifications = new NotificationServiceCreator();

export function makeGetAdminDashboardOverviewUseCase() {
  return new GetAdminDashboardOverviewUseCase(admins);
}

export function makeListAdminUsersUseCase() {
  return new ListAdminUsersUseCase(admins);
}

export function makeGetAdminUserUseCase() {
  return new GetAdminUserUseCase(admins);
}

export function makeSuspendAdminUserUseCase() {
  return new SuspendAdminUserUseCase(admins, auditLog);
}

export function makeReactivateAdminUserUseCase() {
  return new ReactivateAdminUserUseCase(admins, auditLog);
}

export function makeChangeUserRoleUseCase() {
  return new ChangeUserRoleUseCase(admins, auditLog);
}

export function makeListAdminProfessionalsUseCase() {
  return new ListAdminProfessionalsUseCase(admins);
}

export function makeGetAdminProfessionalUseCase() {
  return new GetAdminProfessionalUseCase(admins);
}

export function makeListAdminServiceRequestsUseCase() {
  return new ListAdminServiceRequestsUseCase(admins);
}

export function makeGetAdminServiceRequestUseCase() {
  return new GetAdminServiceRequestUseCase(admins);
}

export function makeListAdminQuotesUseCase() {
  return new ListAdminQuotesUseCase(admins);
}

export function makeGetAdminQuoteUseCase() {
  return new GetAdminQuoteUseCase(admins);
}

export function makeListAdminJobsUseCase() {
  return new ListAdminJobsUseCase(admins);
}

export function makeGetAdminJobUseCase() {
  return new GetAdminJobUseCase(admins);
}

export function makeListAdminReviewsUseCase() {
  return new ListAdminReviewsUseCase(admins);
}

export function makeModerateReviewUseCase() {
  return new ModerateReviewUseCase(admins, auditLog);
}

export function makeRestoreReviewUseCase() {
  return new RestoreReviewUseCase(admins, auditLog);
}

export function makeListAdminPortfolioItemsUseCase() {
  return new ListAdminPortfolioItemsUseCase(admins);
}

export function makeModeratePortfolioItemUseCase() {
  return new ModeratePortfolioItemUseCase(admins, auditLog);
}

export function makeRestorePortfolioItemUseCase() {
  return new RestorePortfolioItemUseCase(admins, auditLog);
}

export function makeListAdminAuditLogsUseCase() {
  return new ListAdminAuditLogsUseCase(auditLog);
}

// --- Companies (Module 18 — Company Professional) ---

export function makeListAdminCompaniesUseCase() {
  return new ListAdminCompaniesUseCase(admins);
}

export function makeGetAdminCompanyUseCase() {
  return new GetAdminCompanyUseCase(admins);
}

export function makeSuspendCompanyUseCase() {
  return new SuspendCompanyUseCase(admins, auditLog, notifications);
}

export function makeReactivateCompanyUseCase() {
  return new ReactivateCompanyUseCase(admins, auditLog, notifications);
}
