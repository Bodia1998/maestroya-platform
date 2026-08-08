import type { RealtimeAccessChecker } from "@/application/ports/realtime-access-checker";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";

/**
 * Module 48 — Real-Time System.
 *
 * The only `RealtimeAccessChecker` implementation. Deliberately reuses
 * this codebase's *existing* repositories rather than issuing its own
 * Prisma queries — "never duplicate functionality" applies just as much
 * to authorization lookups as to business logic. `isJobParticipant`
 * mirrors `resolveDisputeParticipantUserIds`
 * (`application/use-cases/dispute/resolve-dispute-participant-user-ids.ts`)
 * exactly, since a "booking" channel and a dispute's underlying Job share
 * the identical participant set (customer, assigned professional, every
 * active member of the assigned company) — the module brief lists
 * `booking:{id}` as its own channel type, but this domain model has no
 * separate Booking entity, only `Job` (see that file's own doc comment
 * and `docs/MODULE_48_REALTIME_SYSTEM.md`).
 */
export class PrismaRealtimeAccessChecker implements RealtimeAccessChecker {
  constructor(
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly disputes: DisputeRepository,
    private readonly conversations: ConversationRepository,
  ) {}

  async isJobParticipant(userId: string, jobId: string): Promise<boolean> {
    const job = await this.jobs.findById(jobId);
    if (!job) return false;
    return this.isPartyToJob(userId, job.customerId, job.professionalProfileId, job.companyProfileId);
  }

  async isDisputeParticipant(userId: string, disputeId: string): Promise<boolean> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) return false;
    if (dispute.raisedByUserId === userId) return true;

    const job = await this.jobs.findById(dispute.jobId);
    if (!job) return false;
    return this.isPartyToJob(userId, job.customerId, job.professionalProfileId, job.companyProfileId);
  }

  async isConversationParticipant(userId: string, conversationId: string): Promise<boolean> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) return false;
    return conversation.members.some((member) => member.userId === userId && member.leftAt === null);
  }

  async isCompanyMember(userId: string, companyProfileId: string): Promise<boolean> {
    const members = await this.companyMembers.listByCompany(companyProfileId);
    return members.some((member) => member.userId === userId && member.removedAt === null);
  }

  async isProfessionalOwner(userId: string, professionalProfileId: string): Promise<boolean> {
    const professional = await this.professionals.findById(professionalProfileId);
    return professional?.userId === userId;
  }

  private async isPartyToJob(
    userId: string,
    customerId: string,
    professionalProfileId: string | null,
    companyProfileId: string | null,
  ): Promise<boolean> {
    const customer = await this.customerProfiles.findById(customerId);
    if (customer?.userId === userId) return true;

    if (professionalProfileId) {
      const professional = await this.professionals.findById(professionalProfileId);
      if (professional?.userId === userId) return true;
    }

    if (companyProfileId) {
      const members = await this.companyMembers.listByCompany(companyProfileId);
      if (members.some((member) => member.userId === userId && member.removedAt === null)) return true;
    }

    return false;
  }
}
