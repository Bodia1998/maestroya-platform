import type { TrustAppealRepository, TrustAppealRecord } from "@/domain/repositories/trust-appeal-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { AppealSubmitted } from "@/domain/events/appeal-submitted";
import { DuplicateAppealError, TrustAutomatedActionNotFoundError } from "@/domain/errors/domain-error";

/**
 * Module 65 — Trust & Integrity System: requirement #17 — a user submits
 * an appeal against one of their own active `TrustAutomatedAction`s. Only
 * one open (non-terminal) appeal per action is allowed — see
 * `DuplicateAppealError`'s own doc comment.
 */
export interface SubmitAppealInput {
  userId: string;
  automatedActionId: string;
  userStatement: string;
}

export class SubmitAppealUseCase {
  constructor(
    private readonly appeals: TrustAppealRepository,
    private readonly automatedActions: TrustAutomatedActionRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: SubmitAppealInput): Promise<TrustAppealRecord> {
    const action = await this.automatedActions.findById(input.automatedActionId);
    if (!action) throw new TrustAutomatedActionNotFoundError(input.automatedActionId);

    const existingOpen = await this.appeals.findOpenByAutomatedActionId(input.automatedActionId);
    if (existingOpen) throw new DuplicateAppealError(input.automatedActionId);

    const appeal = await this.appeals.create({
      userId: input.userId,
      automatedActionId: input.automatedActionId,
      userStatement: input.userStatement,
    });

    await this.eventBus.publish(new AppealSubmitted(appeal.id, input.userId, input.automatedActionId));
    return appeal;
  }
}
