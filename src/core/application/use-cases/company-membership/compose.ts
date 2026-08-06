import { PrismaCompanyRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { ConsoleFailureReporter } from "@/infrastructure/observability/console-failure-reporter";
import { eventBus } from "@/infrastructure/events/compose";
// Side-effect import: registers NotifyCompanyMembershipChangeSubscriber
// against the shared eventBus. Mirrors verification/compose.ts's own
// identical import of notification/compose.ts — see that file's doc
// comment for why this is imported here rather than relying solely on
// instrumentation.ts.
import "@/application/use-cases/notification/compose";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import { RecordCompanyMembershipAuditLogSubscriber } from "@/application/use-cases/company-membership/record-company-membership-audit-log.subscriber";
import { ChangeCompanyMemberRoleUseCase } from "@/application/use-cases/company-membership/change-company-member-role.use-case";
import { ListCompanyMembersUseCase } from "@/application/use-cases/company-membership/list-company-members.use-case";
import { RemoveCompanyMemberUseCase } from "@/application/use-cases/company-membership/remove-company-member.use-case";
import { TransferCompanyOwnershipUseCase } from "@/application/use-cases/company-membership/transfer-company-ownership.use-case";

const companies = new PrismaCompanyRepository();
const memberships = new PrismaCompanyMembershipRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const failureReporter = new ConsoleFailureReporter();

/**
 * Module 37 — Domain Event Subscribers: registers this module's
 * `CompanyMembershipChanged` audit-log subscriber against the shared
 * `eventBus`, at module load time — the exact pattern documented in
 * `infrastructure/events/compose.ts`'s own doc comment and mirrored from
 * `verification/compose.ts`. The sibling notification subscriber is
 * registered the same way from `notification/compose.ts`; neither file
 * imports the other's use cases.
 */
eventBus.subscribe(CompanyMembershipChanged, new RecordCompanyMembershipAuditLogSubscriber(auditLog));

export function makeListCompanyMembersUseCase() {
  return new ListCompanyMembersUseCase(memberships);
}

export function makeChangeCompanyMemberRoleUseCase() {
  return new ChangeCompanyMemberRoleUseCase(memberships, eventBus, failureReporter);
}

export function makeRemoveCompanyMemberUseCase() {
  return new RemoveCompanyMemberUseCase(memberships, eventBus, failureReporter);
}

export function makeTransferCompanyOwnershipUseCase() {
  return new TransferCompanyOwnershipUseCase(companies, memberships, eventBus, failureReporter);
}
