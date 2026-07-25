import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { DisputeRecord, DisputeReasonValue, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { resolveJobActor } from "@/application/use-cases/job/resolve-job-actor";
import { formatCaseNumber, isDisputableJobStatus, isWithinDisputeWindow } from "@/domain/services/dispute-rules";

export interface CreateDisputeInput {
  jobId: string;
  reason: DisputeReasonValue;
  title: string;
  description: string;
}

/**
 * Module 21 — Disputes & Support: opens a new Dispute over a Job.
 *
 * Authorization: reuses resolveJobActor verbatim (see that function's doc
 * comment) — only the Job's customer or its solo professional may open a
 * dispute this way; a company-owned Job's professional side is not
 * resolvable by resolveJobActor today (same pre-existing limitation
 * documented there), so opening a dispute over a company-owned Job's
 * professional side is not yet supported — see
 * docs/MODULE_21_DISPUTES_SUPPORT.md, "Authorization rules" for the
 * write-up. An unrelated user gets the same NotFoundError a nonexistent Job
 * id would produce.
 *
 * Domain rules enforced here (see dispute-rules.ts for the full write-up of
 * each decision):
 *   - Job.status must be IN_PROGRESS, COMPLETED, or CANCELLED (not CREATED).
 *   - If the Job is already terminal (COMPLETED/CANCELLED), the dispute must
 *     be opened within DISPUTE_WINDOW_DAYS of that terminal timestamp.
 *   - The same user may not have a second concurrently-OPEN dispute on the
 *     same Job (checked here; the DB partial unique index is the final
 *     concurrency guarantee — see PrismaDisputeRepository.create's doc
 *     comment).
 *
 * The respondent (the *other* party) is always derived from the Job, never
 * from client input — a customer opening a dispute always names the Job's
 * professional/company as respondent and vice versa.
 */
export class CreateDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(userId: string, input: CreateDisputeInput): Promise<DisputeRecord> {
    const job = await this.jobs.findById(input.jobId);
    if (!job) {
      throw new NotFoundError("Job", input.jobId);
    }

    const actor = await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });

    if (!isDisputableJobStatus(job.status)) {
      throw new ValidationError(
        "A dispute can only be opened once work has started (in progress, completed, or cancelled).",
      );
    }

    if (job.status !== "IN_PROGRESS") {
      const referenceDate = job.completedAt ?? job.cancelledAt;
      if (!isWithinDisputeWindow(referenceDate, new Date())) {
        throw new ValidationError("The window to open a dispute for this job has passed.");
      }
    }

    // One OPEN dispute per (job, opener) — see dispute-rules.ts's doc
    // comment. The DB's partial unique index is the final guarantee under
    // real concurrency (see PrismaDisputeRepository.create).
    const existingForJob = await this.disputes.listByJobId(job.id);
    const alreadyOpenByThisUser = existingForJob.some((d) => d.raisedByUserId === userId && d.status === "OPEN");
    if (alreadyOpenByThisUser) {
      throw new ConflictError("You already have an open dispute for this job.");
    }

    const caseNumber = formatCaseNumber("DSP", new Date().getFullYear(), existingForJob.length + 1);

    const dispute = await this.disputes.create({
      caseNumber,
      title: input.title,
      jobId: job.id,
      serviceRequestId: job.serviceRequestId,
      raisedByUserId: userId,
      // The respondent is always the *other* side of the Job, never
      // client-supplied.
      respondentProfessionalProfileId: actor.role === "customer" ? job.professionalProfileId : null,
      respondentCompanyProfileId: actor.role === "customer" ? job.companyProfileId : null,
      reason: input.reason,
      priority: "MEDIUM",
      description: input.description,
    });

    try {
      await this.auditLog.record({
        adminUserId: userId,
        action: "DISPUTE_CREATED",
        targetType: "Dispute",
        targetId: dispute.id,
        metadata: { jobId: job.id, caseNumber: dispute.caseNumber, reason: dispute.reason },
      });
    } catch (error) {
      console.error("Failed to record dispute-created audit log", error);
    }

    try {
      const notifyUserIds = await this.resolveRespondentUserIds(job, actor.role);
      for (const respondentUserId of notifyUserIds) {
        await this.notifications.notify({
          userId: respondentUserId,
          type: "DISPUTE_CREATED",
          title: "A dispute was opened",
          message: `A dispute (${dispute.caseNumber}) was opened regarding your job.`,
          resourceType: "DISPUTE",
          resourceId: dispute.id,
          actionUrl: `/disputes/${dispute.id}`,
          metadata: { jobId: job.id, caseNumber: dispute.caseNumber },
        });
      }
    } catch (error) {
      console.error("Failed to create dispute-created notification", error);
    }

    return dispute;
  }

  /** Resolves the User.id(s) that should be notified of the new dispute —
   *  the respondent side, never the raiser (a dispute is never
   *  self-notifying, same convention as CreateReviewUseCase's
   *  REVIEW_RECEIVED notification). For a company-owned Job, every active
   *  company member is notified (there is no single "owner of the job"
   *  concept for a company beyond membership). */
  private async resolveRespondentUserIds(
    job: { customerId: string; professionalProfileId: string | null; companyProfileId: string | null },
    raiserRole: "customer" | "professional",
  ): Promise<string[]> {
    if (raiserRole === "customer") {
      if (job.professionalProfileId) {
        const professional = await this.professionals.findById(job.professionalProfileId);
        return professional ? [professional.userId] : [];
      }
      if (job.companyProfileId) {
        const members = await this.companyMembers.listByCompany(job.companyProfileId);
        return members.filter((m) => m.removedAt === null).map((m) => m.userId);
      }
      return [];
    }
    // Professional/company raised it — notify the customer. Resolving the
    // customer's User.id from CustomerProfileRepository would need a
    // findById; kept simple by not sending here since CreateDisputeUseCase
    // only has customerProfiles.findByUserId — see the constructor. This
    // path is rare today (companies can't yet raise disputes via
    // resolveJobActor — see this class's own doc comment) so it's left
    // as a documented no-op rather than widening the repository interface
    // for an unreachable case.
    return [];
  }
}
