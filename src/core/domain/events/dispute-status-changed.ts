import { DomainEvent } from "@/domain/events/domain-event";
import type { DisputeResolutionValue, DisputeStatusValue } from "@/domain/repositories/dispute-repository";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised whenever an admin transitions a `Dispute`'s status via one of the
 * four dedicated status-mutating use cases (see `ResolveDisputeUseCase`,
 * `RejectDisputeUseCase`, `CloseDisputeUseCase`, `ChangeDisputeStatusUseCase`
 * — `application/use-cases/dispute/`). Follows the exact shape
 * `ProfessionalVerificationStatusChanged`
 * (`domain/events/professional-verification-status-changed.ts`) established:
 * those four use cases each had two independent side effects glued directly
 * into their `execute()` bodies (write an `AdminAuditLogRepository` entry,
 * best-effort fan-out `NotificationCreator.notify` to every participant of
 * the dispute's underlying Job) — the same "several unrelated reactions to
 * one business fact" shape the Module 34 `EventBus` exists for.
 *
 * A Dispute, unlike a ProfessionalVerification, notifies *multiple*
 * recipients at once (both sides of the underlying Job — see
 * `resolveDisputeParticipantUserIds`) rather than a single owner, so this
 * event carries `recipientUserIds: string[]` — resolved server-side by the
 * publishing use case exactly as it already was pre-Module-37 — instead of
 * a single nullable `*UserId` field. The notification subscriber fans out
 * one `notify` call per id, mirroring the `for (const userId of userIds)`
 * loop each use case used to run inline.
 *
 * `transition` distinguishes the four use cases even where `newStatus`
 * alone would be ambiguous or insufficient context for a subscriber:
 * `STATUS_CHANGED` alone covers several distinct `newStatus` values
 * (`UNDER_REVIEW`, `WAITING_FOR_CUSTOMER`, `WAITING_FOR_PROFESSIONAL`) that
 * the notification subscriber must still tell apart (a "response requested"
 * notification differs from a plain "status updated" one) — it does so from
 * `newStatus` itself, carried alongside `transition`, not by inventing a
 * transition value per possible `newStatus`.
 *
 * `AssignDisputeUseCase` and `AddDisputeMessageUseCase` are NOT covered by
 * this event — assignment has a single (possibly null) recipient and no
 * `previousStatus`/`newStatus` pair at all, and a posted message doesn't
 * change `Dispute.status` itself (the auto-transition back to
 * `UNDER_REVIEW` that a party's response can trigger was never audited or
 * notified pre-Module-37 either, and stays that way). Forcing either into
 * this event's shape would mean `null`-ing out fields every subscriber here
 * otherwise always expects. See `DisputeAssigned`
 * (`domain/events/dispute-assigned.ts`) and `DisputeMessageAdded`
 * (`domain/events/dispute-message-added.ts`) for their own, narrower events.
 * `CreateDisputeUseCase` similarly has its own `DisputeCreated`
 * (`domain/events/dispute-created.ts`) — it has no `previousStatus` at all
 * (a Dispute is always created `OPEN`) and resolves its recipients from the
 * *respondent* side only, not every participant.
 */
export class DisputeStatusChanged extends DomainEvent {
  static readonly eventName = "dispute.status-changed";

  constructor(
    readonly disputeId: string,
    readonly caseNumber: string,
    readonly previousStatus: DisputeStatusValue,
    readonly newStatus: DisputeStatusValue,
    /** The admin who performed the transition. Trusted from the Server
     *  Action boundary, same as every other admin-only Dispute use case —
     *  mirrors `RecordAdminAuditLogData.adminUserId`'s own doc comment. */
    readonly actorUserId: string,
    readonly transition: "RESOLVED" | "REJECTED" | "CLOSED" | "STATUS_CHANGED",
    /** Every participant of the dispute's underlying Job, resolved via
     *  `resolveDisputeParticipantUserIds` — the notification subscriber
     *  fans out one `notify` call per entry, unlike the single-recipient
     *  verification events. Empty when the Job could no longer be found
     *  (the same defensive `if (job)` guard the pre-Module-37 use cases had
     *  around their own notify block — the audit subscriber still reacts;
     *  the notification subscriber simply has nothing to fan out to). */
    readonly recipientUserIds: string[],
    /** Set only for `transition: "RESOLVED"` — the business outcome
     *  recorded on the case. `null` for every other transition, mirroring
     *  `ResolveDisputeUseCase`'s own pre-Module-37 audit metadata, which
     *  never included a `resolution` key for the other three transitions. */
    readonly resolution: DisputeResolutionValue | null = null,
  ) {
    super();
  }
}
