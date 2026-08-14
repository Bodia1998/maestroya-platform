import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by
 * `OpenManualReviewCaseUseCase` — a Notifications subscriber uses this to
 * alert the admin queue, mirroring `DisputeCreated`'s own role for Module
 * 21.
 */
export class ManualReviewCreated extends DomainEvent {
  static readonly eventName = "trust_integrity.manual_review.created";

  constructor(
    readonly manualReviewCaseId: string,
    readonly userId: string,
    readonly reason: string,
  ) {
    super();
  }
}
