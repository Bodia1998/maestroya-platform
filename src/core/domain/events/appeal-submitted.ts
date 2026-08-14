import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by `SubmitAppealUseCase`.
 */
export class AppealSubmitted extends DomainEvent {
  static readonly eventName = "trust_integrity.appeal.submitted";

  constructor(
    readonly appealId: string,
    readonly userId: string,
    readonly automatedActionId: string,
  ) {
    super();
  }
}
