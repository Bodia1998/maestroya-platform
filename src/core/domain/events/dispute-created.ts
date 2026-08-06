import { DomainEvent } from "@/domain/events/domain-event";
import type { DisputeReasonValue } from "@/domain/repositories/dispute-repository";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised whenever a new `Dispute` is opened (see `CreateDisputeUseCase`,
 * `application/use-cases/dispute/`). Kept separate from
 * `DisputeStatusChanged` (`domain/events/dispute-status-changed.ts`) — see
 * that event's own doc comment for why — because a freshly created dispute
 * has no `previousStatus` at all (a Dispute is always created `OPEN`) and
 * its recipients are resolved differently: only the *respondent* side of
 * the underlying Job (never the raiser — a dispute is never
 * self-notifying), not every participant the way a status transition fans
 * out to both sides.
 */
export class DisputeCreated extends DomainEvent {
  static readonly eventName = "dispute.created";

  constructor(
    readonly disputeId: string,
    readonly caseNumber: string,
    readonly jobId: string,
    readonly reason: DisputeReasonValue,
    /** The user who opened the dispute — the customer, professional, or a
     *  company member acting on behalf of the company. */
    readonly actorUserId: string,
    /** The respondent side of the underlying Job, resolved via
     *  `CreateDisputeUseCase`'s own `resolveRespondentUserIds` — never
     *  includes `actorUserId`. Empty when the respondent side could not be
     *  resolved (e.g. no professional/company assigned yet), mirroring the
     *  pre-Module-37 use case's own behavior. */
    readonly recipientUserIds: string[],
  ) {
    super();
  }
}
