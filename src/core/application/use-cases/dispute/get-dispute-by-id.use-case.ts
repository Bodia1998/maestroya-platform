import { NotFoundError } from "@/domain/errors/domain-error";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { DisputeMessageRecord, DisputeMessageRepository } from "@/domain/repositories/dispute-message-repository";
import type { DisputeEvidenceRecord, DisputeEvidenceRepository } from "@/domain/repositories/dispute-evidence-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { resolveDisputeActor } from "@/application/use-cases/dispute/resolve-dispute-actor";

export interface DisputeDetail {
  dispute: DisputeRecord;
  messages: DisputeMessageRecord[];
  evidence: DisputeEvidenceRecord[];
}

/**
 * Module 21 — Disputes & Support: fetches a Dispute for a non-admin caller
 * (customer/professional/company) with full IDOR-safe authorization —
 * every fact used to authorize is re-derived server-side (see
 * resolveDisputeActor), never trusted from client input.
 *
 * SECURITY-CRITICAL: this use case always calls
 * `disputeMessages.listPublic`, never `listAll` — a non-admin caller must
 * never be able to read `isInternalNote: true` rows through this path. The
 * admin-facing equivalent (GetAdminDisputeUseCase) is a *separate* class
 * that calls `listAll`, so there is no shared code path where forgetting a
 * role check could leak an internal note to a non-admin.
 */
export class GetDisputeByIdUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly disputeMessages: DisputeMessageRepository,
    private readonly disputeEvidence: DisputeEvidenceRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, disputeId: string): Promise<DisputeDetail> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    const job = await this.jobs.findById(dispute.jobId);
    if (!job) {
      throw new NotFoundError("Dispute", disputeId);
    }

    await resolveDisputeActor(userId, dispute, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      companyMembers: this.companyMembers,
    });

    const [messages, evidence] = await Promise.all([
      this.disputeMessages.listPublic(dispute.id),
      this.disputeEvidence.listByDisputeId(dispute.id),
    ]);

    return { dispute, messages, evidence };
  }
}
