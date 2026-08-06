import { DomainEvent } from "@/domain/events/domain-event";
import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised whenever a `CompanyMember`'s standing within a company changes
 * (see `ChangeCompanyMemberRoleUseCase`, `RemoveCompanyMemberUseCase`,
 * `TransferCompanyOwnershipUseCase` — `application/use-cases/
 * company-membership/`). Follows the exact shape `CompanyStatusChanged`
 * (`domain/events/company-status-changed.ts`) and
 * `ProfessionalVerificationStatusChanged` established: those three use
 * cases each had two independent side effects glued directly into their
 * `execute()` bodies (write an `AdminAuditLogRepository` entry, best-effort
 * `NotificationCreator.notify` the affected member) — the same "several
 * unrelated reactions to one business fact" shape the Module 34 `EventBus`
 * exists for.
 *
 * Unlike `ProfessionalVerificationStatusChanged`/`CompanyStatusChanged`,
 * there is no single `previousStatus`/`newStatus` pair that fits all three
 * source use cases — a role change has an old and a new role on the *same*
 * member, a removal has no "new state" for the member being removed, and
 * an ownership transfer changes two members' roles at once (outgoing OWNER
 * → ADMIN, incoming → OWNER) even though only the incoming owner is
 * notified/audited by member id (the outgoing owner's own role flip is
 * covered by the `Company`-targeted audit entry, exactly as the pre-
 * Module-37 `TransferCompanyOwnershipUseCase` recorded it). Rather than force
 * an artificial `previousStatus`/`newStatus` shape onto all three, this
 * event carries the union of fields each transition actually needs and
 * leaves the rest `null`:
 *
 *  - `ROLE_CHANGED` (`ChangeCompanyMemberRoleUseCase`): `memberId` is the
 *    member whose role changed; `previousRole`/`newRole` are both set;
 *    `selfRemoval` is `null` (not applicable).
 *  - `REMOVED` (`RemoveCompanyMemberUseCase`): `memberId` is the removed
 *    member; `previousRole` is the role they held (mirrors the pre-Module-37
 *    audit entry's `metadata.role`); `newRole` is `null` (removal has no
 *    resulting role); `selfRemoval` records whether the member removed
 *    themself, exactly as the old inline audit call's `metadata.selfRemoval`
 *    did.
 *  - `OWNERSHIP_TRANSFERRED` (`TransferCompanyOwnershipUseCase`): `memberId`
 *    is the *incoming* owner's member id; `previousRole`/`newRole` are both
 *    `null` — the pre-Module-37 audit entry for this transition never
 *    recorded either member's role, only `fromUserId`/`toUserId` (which map
 *    onto this event's `actorUserId`/`targetUserId` — see
 *    `RecordCompanyMembershipAuditLogSubscriber`); `selfRemoval` is `null`
 *    (not applicable).
 *
 * `companyId` and `memberId` are both always carried (rather than only the
 * one the source use case's audit call happened to target) because the
 * audit subscriber's `targetType`/`targetId` differ by transition:
 * `ROLE_CHANGED`/`REMOVED` target `"CompanyMember"`/`memberId` (matching
 * their pre-Module-37 calls), `OWNERSHIP_TRANSFERRED` targets
 * `"Company"`/`companyId` (matching its own pre-Module-37 call) — see that
 * subscriber for the exact mapping.
 */
export class CompanyMembershipChanged extends DomainEvent {
  static readonly eventName = "company-membership.changed";

  constructor(
    readonly companyId: string,
    /** The member record this transition is about: the member whose role
     *  changed (`ROLE_CHANGED`), the removed member (`REMOVED`), or the
     *  incoming owner (`OWNERSHIP_TRANSFERRED`). */
    readonly memberId: string,
    /** The user to notify/audit about — always resolved server-side from
     *  the use case's own `target` lookup, never accepted as client input.
     *  Every source use case already guarantees `target` exists before
     *  reaching its audit/notify tail, so unlike
     *  `ProfessionalVerificationStatusChanged.professionalUserId` this is
     *  never `null` in practice. */
    readonly targetUserId: string,
    /** The user who performed the transition — the caller's own userId in
     *  all three source use cases (an admin/owner/member acting on their
     *  own company, never a platform admin). Mirrors
     *  `RecordAdminAuditLogData.adminUserId`'s own doc comment: a generic
     *  actor, not necessarily an admin. */
    readonly actorUserId: string,
    readonly transition: "ROLE_CHANGED" | "REMOVED" | "OWNERSHIP_TRANSFERRED",
    /** The role `memberId` held before this transition — set for
     *  `ROLE_CHANGED` and `REMOVED`, `null` for `OWNERSHIP_TRANSFERRED`
     *  (see this class's own doc comment for why). */
    readonly previousRole: CompanyMemberRoleValue | null = null,
    /** The role `memberId` holds after this transition — set only for
     *  `ROLE_CHANGED`; `null` for `REMOVED` (no resulting role) and
     *  `OWNERSHIP_TRANSFERRED` (not recorded pre-Module-37, see above). */
    readonly newRole: CompanyMemberRoleValue | null = null,
    /** Whether the member removed themself — set only for `REMOVED`,
     *  `null` for every other transition. Carried on the event, not
     *  recomputed by the audit subscriber, so no subscriber needs to
     *  re-derive "was the actor the target" from `actorUserId`/
     *  `targetUserId` alone (which would be wrong for `ROLE_CHANGED`, where
     *  the actor can never equal the target — see
     *  `ChangeCompanyMemberRoleUseCase`'s own "cannot change your own role"
     *  guard). */
    readonly selfRemoval: boolean | null = null,
  ) {
    super();
  }
}
