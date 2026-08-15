import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 66 — Job Completion & Payment Release Protection.
 *
 * Raised by `ConfirmJobCompletionUseCase` when the customer confirms the
 * completed service was received. Distinct from the (future) actual
 * payout event — this only records that the confirmation step passed;
 * `PaymentReleaseApproved`/`PaymentReleaseHeld` (raised by
 * `EvaluatePaymentReleaseUseCase`, always called right after this) is
 * where the release outcome itself is announced, since confirming does
 * not by itself guarantee release (a payout hold or missing KYC can still
 * hold it — see `payment-release-decision.ts`).
 */
export class CustomerConfirmedCompletion extends DomainEvent {
  static readonly eventName = "job.customer-confirmed-completion";

  constructor(
    readonly jobId: string,
    readonly confirmationId: string,
    readonly confirmedByUserId: string,
    /** The professional/company side's User id(s) to notify. */
    readonly recipientUserIds: string[],
  ) {
    super();
  }
}
