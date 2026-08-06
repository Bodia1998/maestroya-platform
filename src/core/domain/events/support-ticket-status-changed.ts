import { DomainEvent } from "@/domain/events/domain-event";
import type { SupportTicketStatusValue } from "@/domain/repositories/support-ticket-repository";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised by every Module 21 SupportTicket use case that used to write an
 * `AdminAuditLogRepository` entry and best-effort `NotificationCreator.notify`
 * directly in its own `execute()` body (`AssignSupportTicketUseCase`,
 * `ChangeSupportTicketStatusUseCase`, `ResolveSupportTicketUseCase`,
 * `CloseSupportTicketUseCase` — `application/use-cases/support-ticket/`).
 * `CreateSupportTicketUseCase` is deliberately NOT migrated: it only ever
 * wrote an audit entry (there is no assignee yet to notify — see its own
 * doc comment), so there is no "two independent side effects" shape here
 * for `EventBus` to help with. Follows the exact shape
 * `ProfessionalVerificationStatusChanged`
 * (`domain/events/professional-verification-status-changed.ts`) established.
 *
 * Unlike Professional/Company Verification, these four use cases do not all
 * share one clean "previousStatus -> newStatus" transition:
 *
 *  - `AssignSupportTicketUseCase` doesn't change `status` at all — it only
 *    changes `assignedAdminUserId` (and may unassign, setting it back to
 *    `null`). It has no meaningful `previousStatus`/`newStatus` pair.
 *  - `ChangeSupportTicketStatusUseCase` is a genuine status transition
 *    (OPEN -> IN_PROGRESS, IN_PROGRESS <-> WAITING_FOR_USER) with a
 *    dynamic notification message built from `nextStatus` itself
 *    (`` `Ticket ${n} is now ${status}.` ``) — there's no fixed per-transition
 *    copy table entry the way SUBMITTED/APPROVED/etc. have.
 *  - `ResolveSupportTicketUseCase`/`CloseSupportTicketUseCase` are each a
 *    single fixed transition (-> RESOLVED, -> RESOLVED|OPEN -> CLOSED) with
 *    fixed notification copy, closer to the verification module's shape.
 *
 * Rather than force all four into a `previousStatus`/`newStatus` pair that
 * doesn't apply to ASSIGNED, every field below is optional/nullable and
 * `transition` tells a subscriber which fields it can expect to be
 * populated: ASSIGNED populates `previousAssigneeUserId`/`newAssigneeUserId`
 * and leaves `previousStatus`/`newStatus` `null`; the other three populate
 * `previousStatus`/`newStatus` and leave the assignee fields `null`.
 */
export class SupportTicketStatusChanged extends DomainEvent {
  static readonly eventName = "support-ticket.status-changed";

  constructor(
    readonly ticketId: string,
    readonly ticketNumber: string,
    /** The admin who performed the action. Mirrors
     *  `ProfessionalVerificationStatusChanged.actorUserId`'s own doc
     *  comment: a generic actor field, always an admin for this module
     *  since every one of these four use cases is admin-only. */
    readonly actorUserId: string,
    /** The user to notify — resolved server-side by the publishing use
     *  case: the new assignee for ASSIGNED (the assignee the admin just
     *  picked, i.e. `newAssigneeUserId`), the ticket's own opener
     *  (`openedByUserId`) for STATUS_CHANGED/RESOLVED/CLOSED. `null` when
     *  ASSIGNED is actually an *unassignment* (`assigneeUserId` was
     *  `null`) — the pre-Module-37 use case's own `if (assigneeUserId)`
     *  guard around its notify call, now expressed as "the notification
     *  subscriber no-ops for a null recipient", same as
     *  `ProfessionalVerificationStatusChanged.professionalUserId`. */
    readonly recipientUserId: string | null,
    readonly transition: "ASSIGNED" | "STATUS_CHANGED" | "RESOLVED" | "CLOSED",
    /** The ticket's status before this action. `null` for ASSIGNED, which
     *  does not change `status` at all — see this class's own doc comment. */
    readonly previousStatus: SupportTicketStatusValue | null = null,
    /** The ticket's status after this action
     *  (IN_PROGRESS/WAITING_FOR_USER/... for STATUS_CHANGED, `"RESOLVED"`/
     *  `"CLOSED"` for their dedicated use cases). Also `null` for ASSIGNED.
     *  Carried on the event — rather than recomputed by a subscriber —
     *  because `ChangeSupportTicketStatusUseCase`'s notification message is
     *  built dynamically from this value
     *  (`` `Ticket ${n} is now ${newStatus}.` ``), unlike the fixed
     *  per-transition copy the verification modules use. */
    readonly newStatus: SupportTicketStatusValue | null = null,
    /** ASSIGNED-only: the assignee before this action (`null` if the
     *  ticket was unassigned beforehand). `null` for every other
     *  transition. */
    readonly previousAssigneeUserId: string | null = null,
    /** ASSIGNED-only: the assignee after this action (`null` if this
     *  action unassigned the ticket — the same value `recipientUserId` is
     *  derived from). `null` for every other transition. */
    readonly newAssigneeUserId: string | null = null,
  ) {
    super();
  }
}
