import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { JobCompletionConfirmationRecord, JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { ManualReviewCaseRepository } from "@/domain/repositories/manual-review-case-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import { decidePaymentReleaseStatus } from "@/domain/services/payment-release-decision";
import type { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { PaymentReleaseHeld } from "@/domain/events/payment-release-held";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export type AdminPaymentReleaseDecisionInput = "APPROVE" | "HOLD";

/**
 * Module 66 — Job Completion & Payment Release Protection: the admin-only
 * escape hatch for a Job whose `JobCompletionConfirmation.status` is
 * permanently DISPUTED or TIMED_OUT_UNDER_REVIEW (both terminal — see
 * `job-completion-confirmation-state.ts`'s own doc comment). Without this,
 * such a Job could never reach `RELEASE_APPROVED` even after an admin
 * fully investigates and clears it, because `decidePaymentReleaseStatus`
 * treats those two statuses as an always-HELD dead end by design.
 *
 * This is intentionally narrow — it does NOT let an admin bypass payment
 * capture, KYC eligibility, or a Trust & Integrity payout hold (see
 * `payment-release-decision.ts`'s `adminOverrideConfirmed` doc comment:
 * every other condition in the decision function still applies). It also
 * does NOT itself resolve the Dispute or the ManualReviewCase, or issue
 * any refund/adjustment — those remain the existing Module 21
 * (`ResolveDisputeUseCase`/`CloseDisputeUseCase`), Module 65
 * (`TransitionManualReviewCaseUseCase`), and Module 22
 * (`CreateFinancialAdjustmentUseCase`) admin actions, used exactly as
 * they exist today. This use case's only job is the final release
 * decision ITSELF, once the underlying investigation the platform already
 * has tooling for has concluded — the explicit boundary this module's
 * brief asks Module 68 to build on: "Dispute resolution ->
 * FinancialAdjustment -> refund/partial refund/payout release."
 *
 * Precondition enforced here before `APPROVE` is even considered:
 *   - DISPUTED: the linked Dispute must already be CLOSED.
 *   - TIMED_OUT_UNDER_REVIEW: the linked ManualReviewCase must already be
 *     RESOLVED or REJECTED (i.e. no longer OPEN/UNDER_REVIEW/ESCALATED).
 * An admin cannot approve a still-open investigation — this is a
 * *closing* action, not a way to skip the review itself.
 */
export class AdminResolvePaymentReleaseUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly confirmations: JobCompletionConfirmationRepository,
    private readonly disputes: DisputeRepository,
    private readonly manualReviewCases: ManualReviewCaseRepository,
    private readonly payments: PaymentRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly trustAutomatedActions: TrustAutomatedActionRepository,
    private readonly payoutEligibility: CheckPayoutEligibilityUseCase,
    private readonly eventBus: EventBus,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(
    adminUserId: string,
    jobId: string,
    decisionInput: AdminPaymentReleaseDecisionInput,
    note: string,
  ): Promise<JobCompletionConfirmationRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const confirmation = await this.confirmations.findByJobId(jobId);
    if (!confirmation) {
      throw new ValidationError("This job has no completion confirmation record.");
    }

    if (confirmation.status !== "DISPUTED" && confirmation.status !== "TIMED_OUT_UNDER_REVIEW") {
      throw new ValidationError(
        "Admin release resolution only applies to jobs that are disputed or under manual review for a confirmation timeout — every other job is handled by the normal automatic release evaluation.",
      );
    }

    if (decisionInput === "HOLD") {
      const held = await this.confirmations.updateReleaseDecision({
        id: confirmation.id,
        releaseStatus: "RELEASE_HELD",
        releaseReason: `Admin decision: payment remains on hold. ${note}`.trim(),
        releaseDecidedAt: new Date(),
        expectedReleaseStatuses: [confirmation.releaseStatus],
      });
      await this.recordAuditLog(adminUserId, jobId, "HOLD", held);
      await this.publishIfChanged(jobId, confirmation.id, confirmation.releaseStatus, held);
      return held;
    }

    // decisionInput === "APPROVE"
    if (confirmation.status === "DISPUTED") {
      if (!confirmation.disputeId) {
        throw new ValidationError("This job is marked disputed but has no linked dispute — cannot approve release.");
      }
      const dispute = await this.disputes.findById(confirmation.disputeId);
      if (!dispute || dispute.status !== "CLOSED") {
        throw new ValidationError("The linked dispute must be closed before payment release can be approved.");
      }
    } else {
      if (!confirmation.manualReviewCaseId) {
        throw new ValidationError("This job is under manual review but has no linked review case — cannot approve release.");
      }
      const reviewCase = await this.manualReviewCases.findById(confirmation.manualReviewCaseId);
      if (!reviewCase || (reviewCase.state !== "RESOLVED" && reviewCase.state !== "REJECTED")) {
        throw new ValidationError("The linked manual review case must be resolved before payment release can be approved.");
      }
    }

    const [disputesForJob, payments] = await Promise.all([
      this.disputes.listByJobId(jobId),
      this.payments.findByJobId(jobId),
    ]);
    // The specific dispute this confirmation was blocked by is now closed
    // (checked above); a DIFFERENT, still-open dispute on the same job
    // must still block release — hasBlockingDispute below is computed
    // over every dispute on the job, not just the linked one.
    const hasBlockingDispute = disputesForJob.some((d) => d.status !== "CLOSED");
    const payment = payments.find((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") ?? payments[0] ?? null;

    let payoutEligible = false;
    let payoutHoldActive = false;
    if (job.professionalProfileId) {
      const [eligibility, professional] = await Promise.all([
        this.payoutEligibility.execute(job.professionalProfileId),
        this.professionals.findById(job.professionalProfileId),
      ]);
      payoutEligible = eligibility.eligible;
      if (professional) {
        const activeHolds = await this.trustAutomatedActions.listActiveForUser(professional.userId, "PAYOUT_HOLD");
        payoutHoldActive = activeHolds.length > 0;
      }
    }

    const decision = decidePaymentReleaseStatus({
      jobStatus: job.status,
      confirmationStatus: confirmation.status,
      hasBlockingDispute,
      paymentStatus: payment?.status ?? null,
      payoutEligible,
      payoutHoldActive,
      adminOverrideConfirmed: true,
    });

    const updated = await this.confirmations.updateReleaseDecision({
      id: confirmation.id,
      releaseStatus: decision.status,
      releaseReason: `Admin (${adminUserId}) reviewed and cleared this job. ${decision.reason} ${note}`.trim(),
      releaseDecidedAt: new Date(),
      expectedReleaseStatuses: [confirmation.releaseStatus],
    });

    await this.recordAuditLog(adminUserId, jobId, "APPROVE", updated);
    await this.publishIfChanged(jobId, confirmation.id, confirmation.releaseStatus, updated, payment?.id ?? null);
    return updated;
  }

  /** Best-effort — an audit-log write failure must never block the release
   *  decision itself (already persisted above). Same convention as every
   *  other admin use case's audit-log call in this codebase — see e.g.
   *  AddDisputeEvidenceUseCase. */
  private async recordAuditLog(
    adminUserId: string,
    jobId: string,
    decisionInput: AdminPaymentReleaseDecisionInput,
    updated: JobCompletionConfirmationRecord,
  ): Promise<void> {
    try {
      await this.auditLog.record({
        adminUserId,
        action: "PAYMENT_RELEASE_ADMIN_RESOLVED",
        targetType: "JobCompletionConfirmation",
        targetId: updated.id,
        metadata: { jobId, decisionInput, releaseStatus: updated.releaseStatus },
      });
    } catch (error) {
      console.error("Failed to record payment-release-admin-resolved audit log", error);
    }
  }

  private async publishIfChanged(
    jobId: string,
    confirmationId: string,
    previousReleaseStatus: JobCompletionConfirmationRecord["releaseStatus"],
    updated: JobCompletionConfirmationRecord,
    paymentId: string | null = null,
  ): Promise<void> {
    if (updated.releaseStatus === previousReleaseStatus) return;

    const events =
      updated.releaseStatus === "RELEASE_APPROVED"
        ? [new PaymentReleaseApproved(jobId, confirmationId, paymentId)]
        : updated.releaseStatus === "RELEASE_HELD"
          ? [new PaymentReleaseHeld(jobId, confirmationId, updated.releaseReason)]
          : [];

    try {
      await this.eventBus.publishAll(events);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }
  }
}
