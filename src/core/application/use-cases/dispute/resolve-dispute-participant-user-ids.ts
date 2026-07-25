import type { JobRecord } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";

/**
 * Module 21 — Disputes & Support: resolves the User.id(s) of every party to
 * a Dispute's underlying Job — used to fan out status-change/resolution/
 * rejection/closure notifications to both sides at once. Shared by
 * ChangeDisputeStatusUseCase/ResolveDisputeUseCase/RejectDisputeUseCase/
 * CloseDisputeUseCase rather than duplicated per use case.
 */
export async function resolveDisputeParticipantUserIds(
  job: JobRecord,
  deps: {
    customerProfiles: CustomerProfileRepository;
    professionals: ProfessionalRepository;
    companyMembers: CompanyMembershipRepository;
  },
): Promise<string[]> {
  const userIds: string[] = [];

  const customer = await deps.customerProfiles.findById(job.customerId);
  if (customer) userIds.push(customer.userId);

  if (job.professionalProfileId) {
    const professional = await deps.professionals.findById(job.professionalProfileId);
    if (professional) userIds.push(professional.userId);
  }

  if (job.companyProfileId) {
    const members = await deps.companyMembers.listByCompany(job.companyProfileId);
    for (const member of members) {
      if (member.removedAt === null) userIds.push(member.userId);
    }
  }

  return [...new Set(userIds)];
}
