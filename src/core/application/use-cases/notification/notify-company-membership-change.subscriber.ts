import type { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `CompanyMembershipChanged`
 * (`domain/events/company-membership-changed.ts`) — mirrors
 * `NotifyProfessionalVerificationStatusChangeSubscriber` exactly. Reacts to
 * the event by calling the existing `NotificationCreator` port — the same
 * `notify(...)` call the three source use cases used to make directly,
 * each wrapped in their own local `try/catch { console.error(...) }`.
 *
 * Unlike `NOTIFICATION_FOR_TRANSITION` in the verification subscriber, this
 * one is not a static lookup table: `ROLE_CHANGED`'s message interpolates
 * `event.newRole`, which a `Record<transition, ...>` table can't express.
 * `handle` switches on `event.transition` instead — still a straight,
 * no-business-logic translation of the fields each pre-Module-37 use case's
 * own `notify` call already used, byte for byte:
 *
 *  - `ROLE_CHANGED` (`ChangeCompanyMemberRoleUseCase`): notifies
 *    `targetUserId` (the member whose role changed).
 *  - `REMOVED` (`RemoveCompanyMemberUseCase`): notifies `targetUserId` (the
 *    removed member) — including on self-removal; the pre-Module-37 use
 *    case never special-cased `selfRemoval` for notification purposes
 *    either.
 *  - `OWNERSHIP_TRANSFERRED` (`TransferCompanyOwnershipUseCase`): notifies
 *    only `targetUserId` (the *incoming* owner). The pre-Module-37 use case
 *    never notified the outgoing owner (`actorUserId`) about their own role
 *    dropping to ADMIN — this subscriber preserves that exactly rather than
 *    adding a second notification the original behavior never had.
 *
 * `targetUserId` is never `null` (see the event's own doc comment), so
 * unlike the verification subscriber this one has no null-recipient no-op
 * branch to preserve.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 * Does *not* swallow its own failure — it lets a thrown error propagate to
 * `SynchronousEventBus`, which turns it into an `EventDispatchError` the
 * publishing use case reports through `FailureReporter`.
 */
export class NotifyCompanyMembershipChangeSubscriber implements EventHandler<CompanyMembershipChanged> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: CompanyMembershipChanged): Promise<void> {
    const notification = this.buildNotification(event);
    await this.notifications.notify(notification);
  }

  private buildNotification(event: CompanyMembershipChanged): NotificationEvent {
    switch (event.transition) {
      case "ROLE_CHANGED":
        return {
          userId: event.targetUserId,
          type: "COMPANY_MEMBER_ROLE_CHANGED",
          title: "Your role has changed",
          message: `Your role in the company was changed to ${event.newRole}.`,
          resourceType: "COMPANY",
          resourceId: event.companyId,
          actionUrl: "/dashboard/company/members",
        };
      case "REMOVED":
        return {
          userId: event.targetUserId,
          type: "COMPANY_MEMBER_REMOVED",
          title: "You have been removed from a company",
          message: "You are no longer a member of this company.",
          resourceType: "COMPANY",
          resourceId: event.companyId,
        };
      case "OWNERSHIP_TRANSFERRED":
        return {
          userId: event.targetUserId,
          type: "COMPANY_MEMBER_ROLE_CHANGED",
          title: "You are now the company owner",
          message: "Ownership of the company has been transferred to you.",
          resourceType: "COMPANY",
          resourceId: event.companyId,
          actionUrl: "/dashboard/company/profile",
        };
    }
  }
}
