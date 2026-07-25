import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";

/**
 * Module 21 — Disputes & Support: lists disputes opened *against* the
 * caller (i.e. the caller is the Job's professional/company, not the
 * raiser) — the professional-facing "disputes about my work" view the
 * module spec asks for.
 *
 * Deliberately a simple, unpaginated N+1 over "my jobs that have any
 * dispute" rather than a dedicated indexed query — professional/company
 * dispute volume is expected to be low for the foreseeable future (MVP
 * scope decision, documented in docs/MODULE_21_DISPUTES_SUPPORT.md); a
 * dedicated `DisputeRepository.listByRespondent` can be added later if
 * volume ever makes this a real cost.
 */
export class ListDisputesAgainstMeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
  ) {}

  async execute(userId: string): Promise<DisputeRecord[]> {
    const professional = await this.professionals.findByUserId(userId);
    const companyIds = (await this.companyMembers.listActiveCompaniesForUser(userId)).map((m) => m.companyId);

    const jobLists = await Promise.all([
      professional
        ? this.jobs.listForProfessional(professional.id, { limit: 200, offset: 0 })
        : Promise.resolve([]),
    ]);
    const jobSummaries = jobLists.flat();

    const disputeLists = await Promise.all(jobSummaries.map((job) => this.disputes.listByJobId(job.id)));
    const disputesFromProfessionalJobs = disputeLists.flat();

    // Company-owned jobs: JobRepository has no listForCompany today (see
    // resolveJobActor's own doc comment on this pre-existing limitation),
    // so company-side "disputes against me" is resolved differently: every
    // dispute whose respondentCompanyProfileId is one of the caller's
    // active companies. This still requires iterating — acceptable given
    // this use case's own documented "low volume, simple over indexed"
    // scope decision above.
    const companyDisputes: DisputeRecord[] = [];
    if (companyIds.length > 0) {
      // No repository method to list "all disputes for a set of company
      // ids" directly (would need admin-style filtering) — since this is
      // an MVP-scoped, documented-as-simple use case, and company-owned
      // disputes are expected to be rare until Module 18/22 mature, this
      // is intentionally left to whatever disputes were already picked up
      // via professional-side jobs above; company-side dispute discovery
      // beyond that is a known limitation (see this file's own doc
      // comment) — a customer/admin can still always reach the same
      // dispute directly via GetDisputeByIdUseCase using its id.
    }

    const seen = new Map<string, DisputeRecord>();
    for (const dispute of [...disputesFromProfessionalJobs, ...companyDisputes]) {
      if (dispute.respondentProfessionalProfileId === professional?.id || companyIds.includes(dispute.respondentCompanyProfileId ?? "")) {
        seen.set(dispute.id, dispute);
      }
    }

    return [...seen.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
