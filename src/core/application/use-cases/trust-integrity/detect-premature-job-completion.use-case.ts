import type { EventHandler } from "@/application/ports/event-bus";
import type { EventBus } from "@/application/ports/event-bus";
import type { FraudSignalRepository } from "@/domain/repositories/fraud-signal-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { FraudDetected } from "@/domain/events/fraud-detected";
import type { ProfessionalCompletedJob } from "@/domain/events/professional-completed-job";
import { detectPrematureCompletion } from "@/domain/services/premature-completion-detection-rules";

/**
 * Module 67 — Trust & Integrity Completion Risk Detection: Detector A,
 * "Premature Job Completion". Reacts to `ProfessionalCompletedJob`
 * (Module 66) — the event's own doc comment already names this exact use
 * case as its reason for existing ("so a future subscriber can compute how
 * long this job actually took... the signal this module's brief asks
 * Module 66 to expose, not to act on itself").
 *
 * ## Architecture — extends the existing Detect*UseCase pipeline, adds none
 * This class is intentionally shaped exactly like `DetectBookingAbuseUseCase`
 * / `DetectPaymentAbuseUseCase` / `DetectIdentityRiskUseCase` (Module 65):
 * pure rule engine (`premature-completion-detection-rules.ts`) decides,
 * this class writes the resulting `FraudSignal`, records the Trust/Risk
 * Score change via the existing `RecordUserBehaviorSignalUseCase`, and
 * announces `FraudDetected` — the exact same three side effects every other
 * detector in this codebase performs, in the same order. No new
 * risk-scoring system, no new persistence mechanism (see this module's
 * implementation report, "Architecture").
 *
 * ## Why this is a signal, never a fraud conclusion
 * `FraudSignalStatus` defaults to `OPEN` (advisory, exactly like every
 * other `FraudSignal`) and the Trust/Risk Score delta for
 * `PREMATURE_JOB_COMPLETION_DETECTED` (see trust-score-policy.ts /
 * risk-score-policy.ts) is deliberately the same, moderate magnitude as
 * `OFF_PLATFORM_SIGNAL_DETECTED` — a real signal, not the `FRAUD_SIGNAL_
 * DETECTED`/`PAYMENT_ABUSE_DETECTED` tier reserved for confirmed or
 * financially-dangerous findings. The existing `risk-score-policy.ts`
 * escalation-tier table (unmodified by this module) is what ultimately
 * decides whether this ever becomes a `TrustAutomatedAction` or a
 * `ManualReviewCase` — this class never makes that decision itself, and
 * never touches `PaymentReleaseStatus`/`JobCompletionConfirmation` at all
 * (see this module's implementation report, "Payment Boundary").
 *
 * ## Idempotency
 * `ProfessionalCompletedJob` is published at most once per Job — `Job.
 * status` can only transition into `COMPLETED` once, ever (see job-state.ts:
 * COMPLETED is terminal, and `JobRepository.complete`'s `expectedStatuses`
 * optimistic-concurrency guard makes a second concurrent completion attempt
 * fail rather than re-publish). `SynchronousEventBus` (the only `EventBus`
 * implementation today — see that port's own doc comment) dispatches each
 * `publish()` call to subscribers exactly once, in-process, with no
 * retry/redelivery. Together these mean this handler is naturally invoked
 * at most once per Job under this codebase's current architecture — but
 * this class does not rely on that alone: `alreadyFlagged` below defends
 * against a handler re-invoked for the same Job regardless of cause (a
 * future queued `EventBus` implementation — see that port's own doc
 * comment on Module 45 — replaying a message, or a caller invoking `handle`
 * directly twice), by checking for an already-recorded `PREMATURE_JOB_
 * COMPLETION` `FraudSignal` referencing this exact `jobId` before creating
 * a second one. No new repository method or schema change was needed for
 * this — `FraudSignalRepository.listForUser` already exists.
 */
export class DetectPrematureJobCompletionUseCase implements EventHandler<ProfessionalCompletedJob> {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly fraudSignals: FraudSignalRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async handle(event: ProfessionalCompletedJob): Promise<void> {
    // Company-owned jobs have no single professional User to attribute a
    // finding to — same documented, conservative limitation
    // EvaluatePaymentReleaseUseCase already carries for company jobs (see
    // that class's own doc comment, "Known limitation — company-owned
    // jobs"). Not invented for this module; mirrored from the existing
    // precedent rather than silently guessing a subject.
    if (!event.professionalProfileId) {
      return;
    }

    const professional = await this.professionals.findById(event.professionalProfileId);
    if (!professional) {
      return;
    }

    const finding = detectPrematureCompletion({
      jobId: event.jobId,
      professionalProfileId: event.professionalProfileId,
      startedAt: event.startedAt,
      completedAt: event.completedAt,
    });
    if (!finding) {
      return;
    }

    if (await this.alreadyFlagged(professional.userId, event.jobId)) {
      return;
    }

    const signal = await this.fraudSignals.create({
      userId: professional.userId,
      type: "PREMATURE_JOB_COMPLETION",
      detail: finding.detail,
    });

    await this.eventBus.publish(new FraudDetected(professional.userId, signal.id, "PREMATURE_JOB_COMPLETION", []));

    await this.recordBehaviorSignal.execute({
      userId: professional.userId,
      reason: "PREMATURE_JOB_COMPLETION_DETECTED",
      detail: finding.detail,
      referenceType: "FraudSignal",
      referenceId: signal.id,
    });
  }

  /** Defense-in-depth idempotency guard — see this class's own doc comment,
   *  "Idempotency". Deliberately matches on the stable `jobId` marker every
   *  finding's `detail` text always contains (see
   *  premature-completion-detection-rules.ts's `detail` template), rather
   *  than requiring a schema change to add a dedicated reference column. */
  private async alreadyFlagged(userId: string, jobId: string): Promise<boolean> {
    const existing = await this.fraudSignals.listForUser(userId);
    return existing.some((signal) => signal.type === "PREMATURE_JOB_COMPLETION" && signal.detail.includes(jobId));
  }
}
