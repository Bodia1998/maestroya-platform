import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaDisputeEvidenceRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-evidence-repository";
import { PrismaDisputeMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-message-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
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
const notifications = new NotificationServiceCreator();

export function makeCreateDisputeUseCase() {
  return new CreateDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, auditLog, notifications);
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
  return new AssignDisputeUseCase(disputes, auditLog, notifications);
}

export function makeSetDisputePriorityUseCase() {
  return new SetDisputePriorityUseCase(disputes, auditLog);
}

export function makeChangeDisputeStatusUseCase() {
  return new ChangeDisputeStatusUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, auditLog, notifications);
}

export function makeAddDisputeMessageUseCase() {
  return new AddDisputeMessageUseCase(
    disputes,
    disputeMessages,
    jobs,
    customerProfiles,
    professionals,
    companyMembers,
    auditLog,
    notifications,
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
  return new ResolveDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, auditLog, notifications);
}

export function makeRejectDisputeUseCase() {
  return new RejectDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, auditLog, notifications);
}

export function makeCloseDisputeUseCase() {
  return new CloseDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, auditLog, notifications);
}
