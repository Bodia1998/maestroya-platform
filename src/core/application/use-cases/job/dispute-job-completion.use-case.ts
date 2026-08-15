import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { DisputeReasonValue, DisputeRecord } from "@/domain/repositories/dispute-repository";
import { WAITING_FOR_CUSTOMER_STATUS } from "@/domain/services/job-completion-confirmation-state";
import { resolveJobActor } from "./resolve-job-actor";
import type { CreateDisputeUseCase } from "@/application/use-cases/dispute/create-dispute.use-case";
import type { EvaluatePaymentReleaseUseCase } from "./evaluate-payment-release.use-case";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export interface DisputeJobCompletionInput {
  reason: DisputeReasonValue;
  title: string;
  description: string;
}

/**
 * Module 66 — Job Completion & Payment Release Protection: the
 * customer-facing action for "the completed service is wrong/incomplete —
 * hold my payment and open a case", used from the confirmation screen as
 * the alternative to `ConfirmJobCompletionUseCase`. Deliberately does NOT
 * reimplement dispute creation — it is a thin orchestration in front of
 * the existing Module 21 `CreateDisputeUseCase`, which still owns every
 * dispute business rule (disputable-status window, one-open-dispute-per-
 * opener, respondent resolution, DisputeCreated notification/audit-log
 * subscribers). This use case's only added value is: (a) restricting the
 * caller to the customer specifically (CreateDisputeUseCase itself also
 * allows the professional/company side to open disputes, which is out of
 * scope for "reject this completion"), and (b) linking the resulting
 * Dispute back onto the JobCompletionConfirmation row so the release gate
 * can see it without waiting for a second evaluation pass.
 *
 * ## Defense in depth
 * `EvaluatePaymentReleaseUseCase` independently queries
 * `DisputeRepository.listByJobId` on every evaluation (see
 * `payment-release-decision.ts`'s `hasBlockingDispute`) — it does not
 * depend on `JobCompletionConfirmation.disputeId` being set. So even if
 * `markDisputed` below loses a race (e.g. a concurrent timeout already
 * moved the row to TIMED_OUT_UNDER_REVIEW) and this use case's own link
 * step is skipped, the Dispute that was already created by
 * `CreateDisputeUseCase` still blocks release on the very next
 * evaluation. The dispute itself is always the source of truth for
 * "is this job disputed," never `JobCompletionConfirmation.status` alone.
 */
export class DisputeJobCompletionUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly confirmations: JobCompletionConfirmationRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly createDispute: CreateDisputeUseCase,
    private readonly evaluateRelease: EvaluatePaymentReleaseUseCase,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, jobId: string, input: DisputeJobCompletionInput): Promise<DisputeRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const actor = await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });
    if (actor.role !== "customer") {
      throw new ValidationError("Only the customer can dispute this job's completion.");
    }

    const confirmation = await this.confirmations.findByJobId(jobId);
    if (!confirmation) {
      throw new ValidationError("This job has not been marked completed by the professional yet.");
    }
    if (confirmation.status !== WAITING_FOR_CUSTOMER_STATUS) {
      throw new ValidationError("This job's completion confirmation has already been resolved.");
    }

    // Source of truth — created first. See this class's own doc comment,
    // "Defense in depth", for why the confirmation link below is
    // best-effort on top of this, not a two-phase commit.
    const dispute = await this.createDispute.execute(userId, {
      jobId,
      reason: input.reason,
      title: input.title,
      description: input.description,
    });

    try {
      await this.confirmations.markDisputed({
        id: confirmation.id,
        disputeId: dispute.id,
        expectedStatuses: [WAITING_FOR_CUSTOMER_STATUS],
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        this.failureReporter.report(error, {
          jobId,
          confirmationId: confirmation.id,
          disputeId: dispute.id,
          note: "Dispute was created but the confirmation link lost a concurrency race — the dispute still blocks release independently.",
        });
      } else {
        throw error;
      }
    }

    await this.evaluateRelease.execute(jobId);

    return dispute;
  }
}
