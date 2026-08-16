import type { EventHandler, EventBus } from "@/application/ports/event-bus";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { ManualReviewCaseRepository } from "@/domain/repositories/manual-review-case-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { FraudDetected } from "@/domain/events/fraud-detected";
import { ManualReviewCreated } from "@/domain/events/manual-review-created";
import type { DisputeCreated } from "@/domain/events/dispute-created";
import type { ProfessionalCompletedJob } from "@/domain/events/professional-completed-job";
import {
  detectCompletionDuringActiveDispute,
  detectDisputeShortlyAfterCompletion,
} from "@/domain/services/completion-dispute-conflict-detection-rules";

/**
 * Module 67 — Trust & Integrity Completion Risk Detection: Detector B,
 * "Job Completion / Dispute Conflict". Covers both timing directions the
 * pure rule engine (completion-dispute-conflict-detection-rules.ts) can
 * detect — see that file's own doc comment for exactly which of the
 * module's five illustrative scenarios each direction covers, and which
 * are explicitly out of scope for this pass.
 *
 * ## Two entry points, two very different consequences
 * `onDisputeCreated` (scenarios 1/3 — a dispute opened suspiciously soon
 * after completion) is ambiguous about fault by construction — a fast
 * dispute could mean a rushed/defective completion, or a customer gaming
 * the confirmation flow, and this module's own instructions are explicit
 * that "a legitimate customer dispute is normal platform behavior" and the
 * detector "should NOT automatically punish either party". This path
 * therefore does NOT touch either party's Trust/Risk Score at all — it
 * opens a `ManualReviewCase` directly (via the existing
 * `OpenManualReviewCaseUseCase`... actually via the same repository +
 * `ApplyAutomatedActionUseCase`-skipping shape that use case wraps, see
 * below) with `JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED` scored 0 — the
 * exact same "evidence, not proof, so no automatic score movement" pattern
 * `ProcessJobCompletionConfirmationsUseCase` already established for
 * `JOB_COMPLETION_CONFIRMATION_TIMEOUT` (see that reason's own doc comment
 * in trust-score-policy.ts). The case subject is the dispute's raiser —
 * not an accusation, purely the existing single-subject `ManualReviewCase`
 * queue's required field, mirroring that same precedent's own disclaimer.
 *
 * `onProfessionalCompletedJob` (scenarios 2/5 — completing a Job while a
 * dispute is already open on it) IS attributed to whoever completed the
 * Job and DOES move the Trust/Risk Score, through the same `FraudSignal` +
 * `RecordUserBehaviorSignalUseCase` pipeline `DetectPrematureJobCompletionUseCase`
 * uses — this is a stronger, actor-specific signal (see
 * completion-dispute-conflict-detection-rules.ts's own doc comment on why
 * the two scenarios are scored differently).
 *
 * ## Payment boundary
 * Neither entry point ever reads or writes `PaymentReleaseStatus`,
 * `JobCompletionConfirmation`, or any Payment/commission record — the
 * existing `EvaluatePaymentReleaseUseCase` already independently observes
 * every open Dispute on a Job via its own `hasBlockingDispute` computation
 * (payment-release-decision.ts) every time it re-evaluates, which happens
 * on every Dispute-affecting action already wired by Module 66/21. A Trust
 * & Integrity consequence of a finding here (e.g. a `PAYOUT_HOLD` from
 * `PAYMENT_ABUSE_DETECTED`-style escalation) only ever reaches payment
 * release through that same existing path — never a new one this class
 * introduces. See this module's implementation report, "Payment Boundary".
 *
 * ## Idempotency
 * `DisputeCreated` fires at most once per Dispute (`DisputeRepository.create`
 * produces a new row per call; two disputes are two distinct facts, not a
 * duplicate of one). `ProfessionalCompletedJob` fires at most once per Job
 * (see `DetectPrematureJobCompletionUseCase`'s own doc comment). Both
 * handlers additionally defend against re-invocation the same way that
 * class does: `onDisputeCreated` checks for an existing `ManualReviewCase`
 * referencing this `jobId`+`disputeId` pair before opening a new one;
 * `onProfessionalCompletedJob` checks for an existing `COMPLETION_DURING_
 * ACTIVE_DISPUTE` `FraudSignal` referencing this `jobId` before creating one.
 */
export class DetectJobCompletionDisputeConflictUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly disputes: DisputeRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly fraudSignals: FraudSignalRepository,
    private readonly manualReviewCases: ManualReviewCaseRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  /** Scenarios 1/3 — see this class's own doc comment. */
  async onDisputeCreated(event: DisputeCreated): Promise<void> {
    const job = await this.jobs.findById(event.jobId);
    if (!job || job.completedAt === null) {
      // Nothing completed yet to be "shortly after" — not this scenario.
      return;
    }

    const finding = detectDisputeShortlyAfterCompletion({
      jobId: event.jobId,
      disputeId: event.disputeId,
      raisedByUserId: event.actorUserId,
      professionalProfileId: job.professionalProfileId,
      jobCompletedAt: job.completedAt,
      disputeCreatedAt: event.occurredAt,
    });
    if (!finding) {
      return;
    }

    if (await this.alreadyReviewed(event.actorUserId, event.jobId, event.disputeId)) {
      return;
    }

    const reviewCase = await this.manualReviewCases.create({
      userId: event.actorUserId,
      reason: "JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED",
      summary: `Job ${event.jobId} / Dispute ${event.disputeId}: ${finding.detail}`,
    });

    // Deliberately skips ApplyAutomatedActionUseCase — same
    // "skipAutomatedAction: true" shape OpenManualReviewCaseUseCase exposes
    // for exactly this reason (ambiguous fault, no score movement yet; see
    // this class's own doc comment). Recreating that use case's own
    // create+publish here (rather than depending on it directly) avoids a
    // constructor dependency this handler would otherwise have to satisfy
    // with a real ApplyAutomatedActionUseCase it will never call.
    await this.eventBus.publish(
      new ManualReviewCreated(reviewCase.id, event.actorUserId, "JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED"),
    );
  }

  /** Scenarios 2/5 — see this class's own doc comment. */
  async onProfessionalCompletedJob(event: ProfessionalCompletedJob): Promise<void> {
    if (!event.professionalProfileId) {
      // Company-owned jobs — same documented limitation as
      // DetectPrematureJobCompletionUseCase (mirrors Module 66's own
      // company-job scope boundary rather than inventing coverage for it).
      return;
    }

    const disputesForJob = await this.disputes.listByJobId(event.jobId);
    const openDisputeIds = disputesForJob.filter((d) => d.status !== "CLOSED").map((d) => d.id);

    const finding = detectCompletionDuringActiveDispute({
      jobId: event.jobId,
      professionalProfileId: event.professionalProfileId,
      completedByUserId: event.actorUserId,
      completedAt: event.completedAt,
      openDisputeIds,
    });
    if (!finding) {
      return;
    }

    const professional = await this.professionals.findById(event.professionalProfileId);
    if (!professional) {
      return;
    }

    if (await this.alreadyFlagged(professional.userId, event.jobId)) {
      return;
    }

    const signal = await this.fraudSignals.create({
      userId: professional.userId,
      type: "COMPLETION_DURING_ACTIVE_DISPUTE",
      detail: finding.detail,
    });

    await this.eventBus.publish(
      new FraudDetected(professional.userId, signal.id, "COMPLETION_DURING_ACTIVE_DISPUTE", []),
    );

    await this.recordBehaviorSignal.execute({
      userId: professional.userId,
      reason: "COMPLETION_DURING_ACTIVE_DISPUTE_DETECTED",
      detail: finding.detail,
      referenceType: "FraudSignal",
      referenceId: signal.id,
    });
  }

  private async alreadyReviewed(userId: string, jobId: string, disputeId: string): Promise<boolean> {
    const existing = await this.manualReviewCases.listForUser(userId);
    return existing.some(
      (reviewCase) =>
        reviewCase.reason === "JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED" &&
        reviewCase.summary.includes(jobId) &&
        reviewCase.summary.includes(disputeId),
    );
  }

  private async alreadyFlagged(userId: string, jobId: string): Promise<boolean> {
    const existing = await this.fraudSignals.listForUser(userId);
    return existing.some((signal) => signal.type === "COMPLETION_DURING_ACTIVE_DISPUTE" && signal.detail.includes(jobId));
  }
}

/** Thin `EventBus` adapter for `onDisputeCreated` — see `EventHandler`'s own
 *  doc comment on why handlers are classes (constructor injection) rather
 *  than bare functions. Kept as a one-line wrapper (rather than having
 *  `DetectJobCompletionDisputeConflictUseCase` itself implement two
 *  same-named `handle` methods, which TypeScript cannot express for two
 *  different event types on one class) so both entry points still share
 *  every dependency/instance via the single use case above. */
export class JobCompletionDisputeConflictOnDisputeCreatedSubscriber implements EventHandler<DisputeCreated> {
  constructor(private readonly detector: DetectJobCompletionDisputeConflictUseCase) {}

  async handle(event: DisputeCreated): Promise<void> {
    await this.detector.onDisputeCreated(event);
  }
}

/** Thin `EventBus` adapter for `onProfessionalCompletedJob` — see
 *  `JobCompletionDisputeConflictOnDisputeCreatedSubscriber`'s own doc
 *  comment. */
export class JobCompletionDisputeConflictOnProfessionalCompletedJobSubscriber
  implements EventHandler<ProfessionalCompletedJob>
{
  constructor(private readonly detector: DetectJobCompletionDisputeConflictUseCase) {}

  async handle(event: ProfessionalCompletedJob): Promise<void> {
    await this.detector.onProfessionalCompletedJob(event);
  }
}
