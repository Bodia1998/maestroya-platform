import { DomainEvent } from "@/domain/events/domain-event";
import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised for every Company Invitation (Module 18) business fact that used
 * to write an `AdminAuditLogRepository` entry and best-effort
 * `NotificationCreator.notify` a single recipient directly inside its own
 * `execute()` body: `CreateCompanyInvitationUseCase`,
 * `AcceptCompanyInvitationUseCase`, `DeclineCompanyInvitationUseCase`
 * (`application/use-cases/company-invitation/`). Follows the exact shape
 * `ProfessionalVerificationStatusChanged`
 * (`domain/events/professional-verification-status-changed.ts`)
 * established — same "several unrelated reactions to one business fact"
 * shape the Module 34 `EventBus` exists for.
 *
 * Unlike `ProfessionalVerificationStatusChanged`/`CompanyStatusChanged`,
 * `CREATED` is not a transition of an *existing* invitation's status — it's
 * the invitation coming into existence in the first place, so there is no
 * real "previous status" to carry (an invitation is always born PENDING).
 * Rather than force a fictitious `previousStatus`/`newStatus` pair onto a
 * creation event, this event follows the *spirit* of those two references
 * (one event per business fact, a `transition` discriminant so subscribers
 * can route without re-deriving intent) instead of their letter: it drops
 * `previousStatus` entirely and carries only `newStatus` — always
 * `"PENDING"` for `CREATED`, `"ACCEPTED"`/`"DECLINED"` for the other two
 * transitions, which *are* genuine status changes of an existing row.
 *
 * `CancelCompanyInvitationUseCase` (CANCELLED) deliberately keeps its
 * direct `AdminAuditLogRepository` call and is NOT part of this event — it
 * never calls `NotificationCreator` (confirmed by reading its current
 * source), so there is no second reaction for an `EventBus` to fan out to;
 * migrating a single audit-only write to publish-and-subscribe would only
 * add indirection.
 *
 * The three transitions this event *does* cover each have a single
 * recipient, but — unlike `ProfessionalVerificationStatusChanged`, where
 * the recipient is always the professional — *which* party that is
 * flips with the transition, because a company invitation has two
 * interested parties (the invitee and the inviter) who never both get
 * notified for the same fact:
 *   - `CREATED`: the invitee (`CreateCompanyInvitationUseCase` notified
 *     `invitedUser.id`, guarded by `if (invitedUser)` — an invitation to an
 *     email with no matching account notifies nobody, same as before).
 *   - `ACCEPTED`/`DECLINED`: the inviter (`AcceptCompanyInvitationUseCase`/
 *     `DeclineCompanyInvitationUseCase` both notified
 *     `invitation.invitedByUserId` unconditionally — always present, never
 *     null, since every invitation has an inviter).
 * `recipientUserId` carries whichever of those the publishing use case
 * resolved, mirroring `ProfessionalVerificationStatusChanged.professionalUserId`'s
 * own doc comment: `null` only for the one defensive case
 * (`CREATED` with no matching account) where the pre-Module-37 code itself
 * skipped the notification.
 */
export class CompanyInvitationStatusChanged extends DomainEvent {
  static readonly eventName = "company-invitation.status-changed";

  constructor(
    readonly invitationId: string,
    readonly companyId: string,
    /** The single party to notify for this transition — resolved
     *  server-side by the publishing use case. See this class's own doc
     *  comment for why this is the invitee for `CREATED` but the inviter
     *  for `ACCEPTED`/`DECLINED`. `null` only for the defensive
     *  "invited email has no matching account" case on `CREATED`. */
    readonly recipientUserId: string | null,
    /** The user who performed the transition: the inviting owner/admin for
     *  `CREATED`, the invited user themselves for `ACCEPTED`/`DECLINED`.
     *  Mirrors `RecordAdminAuditLogData.adminUserId`'s own doc comment: a
     *  generic actor, not necessarily an admin. */
    readonly actorUserId: string,
    readonly newStatus: "PENDING" | "ACCEPTED" | "DECLINED",
    readonly transition: "CREATED" | "ACCEPTED" | "DECLINED",
    /** The invited role — carried for `CREATED` and `ACCEPTED` audit
     *  metadata (`{ companyId, email, role }` / `{ companyId, role }`),
     *  `null` for `DECLINED`, which never recorded a role in its metadata.
     *  Carried on the event, not recomputed by the audit subscriber, so no
     *  subscriber needs an invitation-lookup dependency it otherwise
     *  wouldn't need. */
    readonly role: CompanyMemberRoleValue | null = null,
    /** The invited email address — carried only for `CREATED` audit
     *  metadata (`{ companyId, email, role }`); `null` for
     *  `ACCEPTED`/`DECLINED`, whose pre-Module-37 metadata never included
     *  it. */
    readonly email: string | null = null,
  ) {
    super();
  }
}
