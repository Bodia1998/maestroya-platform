import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised whenever a public message is posted on a `Dispute`'s thread (see
 * `AddDisputeMessageUseCase`, `application/use-cases/dispute/`). Kept
 * separate from `DisputeStatusChanged`
 * (`domain/events/dispute-status-changed.ts`) — see that event's own doc
 * comment for why — because posting a message never changes
 * `Dispute.status` itself: the use case's own auto-transition back to
 * `UNDER_REVIEW` when the waited-on party responds is a *side effect* of
 * the message, applied separately and — pre-Module-37 as well as after —
 * never itself audited or notified. This event only carries what the old
 * inline "new message" notification block needed.
 */
export class DisputeMessageAdded extends DomainEvent {
  static readonly eventName = "dispute.message-added";

  constructor(
    readonly disputeId: string,
    readonly caseNumber: string,
    readonly messageId: string,
    /** The user who posted the message — an admin, the customer, or the
     *  professional/company side. Never itself a notification recipient
     *  (a message never self-notifies its own author). */
    readonly actorUserId: string,
    /** Every other participant of the dispute (the raiser plus the Job's
     *  customer/professional/company members), excluding `actorUserId` —
     *  resolved server-side by the publishing use case exactly as it was
     *  pre-Module-37. Empty when the Job could no longer be found. */
    readonly recipientUserIds: string[],
  ) {
    super();
  }
}
