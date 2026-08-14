import type { ManualReviewCaseRepository, ManualReviewCaseRecord } from "@/domain/repositories/manual-review-case-repository";
import type { ApplyAutomatedActionUseCase } from "@/application/use-cases/trust-integrity/apply-automated-action.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { ManualReviewCreated } from "@/domain/events/manual-review-created";
import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

/**
 * Module 65 — Trust & Integrity System: requirement #16. Opens a new
 * `ManualReviewCase` (state `OPEN`) and, unless the caller already applied
 * one (`skipAutomatedAction`), also records the corresponding
 * `MANUAL_REVIEW` `TrustAutomatedAction` via `ApplyAutomatedActionUseCase`
 * — see that use case's own module-level doc comment on why the case and
 * the action are two separate rows.
 */
export interface OpenManualReviewCaseInput {
  userId: string;
  reason: TrustRiskEventReasonValue;
  summary: string;
  riskScore: number;
  skipAutomatedAction?: boolean;
}

export class OpenManualReviewCaseUseCase {
  constructor(
    private readonly manualReviewCases: ManualReviewCaseRepository,
    private readonly applyAutomatedAction: ApplyAutomatedActionUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: OpenManualReviewCaseInput): Promise<ManualReviewCaseRecord> {
    const manualReviewCase = await this.manualReviewCases.create({
      userId: input.userId,
      reason: input.reason,
      summary: input.summary,
    });

    if (!input.skipAutomatedAction) {
      await this.applyAutomatedAction.execute({
        userId: input.userId,
        riskScore: input.riskScore,
        reason: input.reason,
        detail: input.summary,
      });
    }

    await this.eventBus.publish(new ManualReviewCreated(manualReviewCase.id, input.userId, input.reason));
    return manualReviewCase;
  }
}
