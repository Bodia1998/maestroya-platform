import type { TrustAppealRepository, TrustAppealRecord } from "@/domain/repositories/trust-appeal-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import type { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { AppealApproved } from "@/domain/events/appeal-approved";
import { AppealRejected } from "@/domain/events/appeal-rejected";
import { AccountReinstated } from "@/domain/events/account-reinstated";
import { TrustAppealNotFoundError } from "@/domain/errors/domain-error";
import { assertValidAppealTransition } from "@/domain/entities/appeal";

/**
 * Module 65 — Trust & Integrity System: requirement #17. An admin decides
 * an appeal. Approval walks the appeal through `UNDER_REVIEW -> APPROVED ->
 * ACCOUNT_RESTORED` in one call (see `domain/entities/appeal.ts`'s doc
 * comment for why those are kept as distinct states even though this use
 * case advances both at once): it reverses the underlying
 * `TrustAutomatedAction`, restores the Trust Score via
 * `APPEAL_APPROVED`, and announces `AccountReinstated`. Rejection leaves
 * the action in effect and moves the appeal straight to the terminal
 * `REJECTED` state.
 */
export interface ReviewAppealInput {
  appealId: string;
  decision: "APPROVED" | "REJECTED";
  reviewedByUserId: string;
  reviewNotes?: string;
}

export class ReviewAppealUseCase {
  constructor(
    private readonly appeals: TrustAppealRepository,
    private readonly automatedActions: TrustAutomatedActionRepository,
    private readonly recordBehaviorSignal: RecordUserBehaviorSignalUseCase,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: ReviewAppealInput): Promise<TrustAppealRecord> {
    const appeal = await this.appeals.findById(input.appealId);
    if (!appeal) throw new TrustAppealNotFoundError(input.appealId);

    assertValidAppealTransition(appeal.state, "UNDER_REVIEW");
    await this.appeals.transition(appeal.id, "UNDER_REVIEW");

    if (input.decision === "REJECTED") {
      assertValidAppealTransition("UNDER_REVIEW", "REJECTED");
      const rejected = await this.appeals.transition(appeal.id, "REJECTED", {
        reviewedByUserId: input.reviewedByUserId,
        reviewNotes: input.reviewNotes,
      });
      await this.eventBus.publish(new AppealRejected(appeal.id, appeal.userId, input.reviewedByUserId, input.reviewNotes ?? ""));
      return rejected;
    }

    assertValidAppealTransition("UNDER_REVIEW", "APPROVED");
    await this.appeals.transition(appeal.id, "APPROVED", {
      reviewedByUserId: input.reviewedByUserId,
      reviewNotes: input.reviewNotes,
    });
    await this.eventBus.publish(new AppealApproved(appeal.id, appeal.userId, input.reviewedByUserId));

    await this.automatedActions.reverse(appeal.automatedActionId, input.reviewedByUserId);
    await this.recordBehaviorSignal.execute({
      userId: appeal.userId,
      reason: "APPEAL_APPROVED",
      detail: `Appeal approved: ${input.reviewNotes ?? "no additional notes"}.`,
      referenceType: "TrustAppeal",
      referenceId: appeal.id,
    });

    assertValidAppealTransition("APPROVED", "ACCOUNT_RESTORED");
    const restored = await this.appeals.transition(appeal.id, "ACCOUNT_RESTORED", { restoredAt: new Date() });
    await this.eventBus.publish(new AccountReinstated(appeal.userId, appeal.automatedActionId, appeal.id));

    return restored;
  }
}
