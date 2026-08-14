import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by
 * `TransitionManualReviewCaseUseCase` when a case reaches a terminal state
 * (`RESOLVED` or `REJECTED`) — see `isTerminalManualReviewState`.
 */
export class ManualReviewResolved extends DomainEvent {
  static readonly eventName = "trust_integrity.manual_review.resolved";

  constructor(
    readonly manualReviewCaseId: string,
    readonly userId: string,
    readonly finalState: "RESOLVED" | "REJECTED",
    readonly resolvedByUserId: string,
  ) {
    super();
  }
}
