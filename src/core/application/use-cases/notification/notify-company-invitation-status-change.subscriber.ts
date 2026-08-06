import type { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

const NOTIFICATION_FOR_TRANSITION: Record<
  CompanyInvitationStatusChanged["transition"],
  Pick<NotificationEvent, "type" | "title" | "message" | "resourceType" | "actionUrl">
> = {
  CREATED: {
    type: "COMPANY_INVITATION_RECEIVED",
    title: "You've been invited to join a company",
    message: "You have a pending company invitation.",
    resourceType: "COMPANY_INVITATION",
    actionUrl: "/dashboard/company/invitations",
  },
  ACCEPTED: {
    type: "COMPANY_INVITATION_ACCEPTED",
    title: "Invitation accepted",
    message: "A pending company invitation was accepted.",
    resourceType: "COMPANY",
    actionUrl: "/dashboard/company/members",
  },
  DECLINED: {
    type: "COMPANY_INVITATION_DECLINED",
    title: "Invitation declined",
    message: "A pending company invitation was declined.",
    resourceType: "COMPANY",
    actionUrl: "/dashboard/company/invitations",
  },
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `CompanyInvitationStatusChanged`
 * (`domain/events/company-invitation-status-changed.ts`) — mirrors
 * `NotifyProfessionalVerificationStatusChangeSubscriber` exactly. Reacts to
 * the event by calling the existing `NotificationCreator` port — the same
 * `notify(...)` call `CreateCompanyInvitationUseCase`/
 * `AcceptCompanyInvitationUseCase`/`DeclineCompanyInvitationUseCase` used to
 * make directly, each wrapped in their own local
 * `try/catch { console.error(...) }`. No business logic here:
 * `NOTIFICATION_FOR_TRANSITION` is a straight translation table from the
 * event's `transition` to the type/title/message/resourceType/actionUrl
 * those use cases already used, byte for byte. `resourceId` is the one
 * thing that isn't a static per-transition constant — it's the invitation
 * itself for `CREATED` (`resourceType: "COMPANY_INVITATION"`) but the
 * company for `ACCEPTED`/`DECLINED` (`resourceType: "COMPANY"`), exactly as
 * each use case resolved it before.
 *
 * A `null` `recipientUserId` (the defensive "invited email has no matching
 * account" edge case on `CREATED` — see the event's own doc comment) is a
 * no-op, not an error: `CreateCompanyInvitationUseCase` silently skipped
 * the notification in that case too (while still recording the audit entry
 * via the sibling subscriber).
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 * Unlike the old inline `try/catch`, this subscriber does *not* swallow its
 * own failure — it lets a thrown error propagate to `SynchronousEventBus`,
 * which turns it into an `EventDispatchError` the publishing use case
 * reports through `FailureReporter`.
 */
export class NotifyCompanyInvitationStatusChangeSubscriber implements EventHandler<CompanyInvitationStatusChanged> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: CompanyInvitationStatusChanged): Promise<void> {
    if (!event.recipientUserId) return;

    const { type, title, message, resourceType, actionUrl } = NOTIFICATION_FOR_TRANSITION[event.transition];
    const resourceId = event.transition === "CREATED" ? event.invitationId : event.companyId;

    await this.notifications.notify({
      userId: event.recipientUserId,
      type,
      title,
      message,
      resourceType,
      resourceId,
      actionUrl,
    });
  }
}
