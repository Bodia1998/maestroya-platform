import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 66 — Job Completion & Payment Release Protection.
 *
 * Raised by `ProcessJobCompletionConfirmationsUseCase` when a
 * confirmation window elapses with no customer response. Per the
 * confirmed product decision, this NEVER implies release — it always
 * accompanies a `ManualReviewCase` being opened (see `manualReviewCaseId`)
 * and a `RELEASE_HELD` outcome. A signal Module 67 can also use to spot
 * "repeated non-response" patterns without owning this module's own
 * timeout mechanics.
 */
export class CustomerConfirmationTimedOut extends DomainEvent {
  static readonly eventName = "job.customer-confirmation-timed-out";

  constructor(
    readonly jobId: string,
    readonly confirmationId: string,
    readonly manualReviewCaseId: string,
    /** Both the customer's and the professional's/company's User id(s). */
    readonly recipientUserIds: string[],
  ) {
    super();
  }
}
