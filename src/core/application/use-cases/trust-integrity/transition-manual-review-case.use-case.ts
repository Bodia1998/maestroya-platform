import type { ManualReviewCaseRepository, ManualReviewCaseRecord } from "@/domain/repositories/manual-review-case-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { ManualReviewResolved } from "@/domain/events/manual-review-resolved";
import { ManualReviewCaseNotFoundError } from "@/domain/errors/domain-error";
import { assertValidManualReviewTransition, isTerminalManualReviewState, type ManualReviewCaseStateValue } from "@/domain/entities/manual-review-case";

/**
 * Module 65 — Trust & Integrity System: requirement #16 — advances a
 * `ManualReviewCase` through its state machine
 * (`domain/entities/manual-review-case.ts`). Reaching `RESOLVED` with a
 * `CONFIRMED` outcome additionally records a `MANUAL_REVIEW_CONFIRMED`
 * behavior signal (a human confirming the suspicion is a much stronger
 * Risk Score signal than the automated detector alone) — a case resolved
 * as `REJECTED` (false positive) does not move any score.
 */
export interface TransitionManualReviewCaseInput {
  manualReviewCaseId: string;
  targetState: ManualReviewCaseStateValue;
  actingUserId: string;
  resolutionNotes?: string;
  /** True when RESOLVED means "the suspicion was confirmed" (as opposed to
   *  "resolved, no action needed") — only meaningful when targetState is
   *  RESOLVED. */
  confirmed?: boolean;
}

export class TransitionManualReviewCaseUseCase {
  constructor(
    private readonly manualReviewCases: ManualReviewCaseRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: TransitionManualReviewCaseInput): Promise<ManualReviewCaseRecord> {
    const current = await this.manualReviewCases.findById(input.manualReviewCaseId);
    if (!current) throw new ManualReviewCaseNotFoundError(input.manualReviewCaseId);

    assertValidManualReviewTransition(current.state, input.targetState);

    const updated = await this.manualReviewCases.transition(input.manualReviewCaseId, input.targetState, {
      resolvedByUserId: isTerminalManualReviewState(input.targetState) ? input.actingUserId : undefined,
      resolutionNotes: input.resolutionNotes,
    });

    if (input.targetState === "RESOLVED" && input.confirmed) {
      await this.recordBehaviorSignal.execute({
        userId: current.userId,
        reason: "MANUAL_REVIEW_CONFIRMED",
        detail: input.resolutionNotes ?? "Manual review confirmed the suspected violation.",
        referenceType: "ManualReviewCase",
        referenceId: current.id,
      });
    }

    if (isTerminalManualReviewState(input.targetState)) {
      await this.eventBus.publish(
        new ManualReviewResolved(current.id, current.userId, input.targetState as "RESOLVED" | "REJECTED", input.actingUserId),
      );
    }

    return updated;
  }
}
