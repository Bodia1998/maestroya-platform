import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised whenever an admin (re)assigns or unassigns a `Dispute` (see
 * `AssignDisputeUseCase`, `application/use-cases/dispute/`). Kept separate
 * from `DisputeStatusChanged` (`domain/events/dispute-status-changed.ts`) —
 * see that event's own doc comment for why — because assignment has a
 * fundamentally different shape: a single (possibly `null`, when
 * unassigning) recipient rather than a fan-out list, and no
 * `previousStatus`/`newStatus` pair at all (`Dispute.status` is untouched
 * by an assignment).
 */
export class DisputeAssigned extends DomainEvent {
  static readonly eventName = "dispute.assigned";

  constructor(
    readonly disputeId: string,
    readonly caseNumber: string,
    /** The previously assigned admin/support agent, if any — carried on the
     *  event so the audit subscriber can reproduce
     *  `AssignDisputeUseCase`'s pre-Module-37 `{ previousAssignee,
     *  newAssignee }` metadata exactly. */
    readonly previousAssigneeUserId: string | null,
    /** The newly assigned admin/support agent — `null` means the dispute
     *  was unassigned. The notification subscriber no-ops when `null`,
     *  mirroring the `if (assigneeUserId)` guard the use case had around
     *  its own inline `notify` call. */
    readonly newAssigneeUserId: string | null,
    /** The admin who performed the (un)assignment. */
    readonly actorUserId: string,
  ) {
    super();
  }
}
