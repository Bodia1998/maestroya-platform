import { PrismaNotificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-notification-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { eventBus } from "@/infrastructure/events/compose";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import { DisputeAssigned } from "@/domain/events/dispute-assigned";
import { DisputeCreated } from "@/domain/events/dispute-created";
import { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import { CreateNotificationUseCase } from "@/application/use-cases/notification/create-notification.use-case";
import { DismissNotificationUseCase } from "@/application/use-cases/notification/dismiss-notification.use-case";
import { GetNotificationUseCase } from "@/application/use-cases/notification/get-notification.use-case";
import { GetUnreadNotificationCountUseCase } from "@/application/use-cases/notification/get-unread-notification-count.use-case";
import { ListNotificationsUseCase } from "@/application/use-cases/notification/list-notifications.use-case";
import { MarkAllNotificationsAsReadUseCase } from "@/application/use-cases/notification/mark-all-notifications-as-read.use-case";
import { MarkNotificationAsReadUseCase } from "@/application/use-cases/notification/mark-notification-as-read.use-case";
import { NotifyCompanyInvitationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-company-invitation-status-change.subscriber";
import { NotifyCompanyMembershipChangeSubscriber } from "@/application/use-cases/notification/notify-company-membership-change.subscriber";
import { NotifyCompanyStatusChangeSubscriber } from "@/application/use-cases/notification/notify-company-status-change.subscriber";
import { NotifyCompanyVerificationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-company-verification-status-change.subscriber";
import { NotifyDisputeAssignedSubscriber } from "@/application/use-cases/notification/notify-dispute-assigned.subscriber";
import { NotifyDisputeCreatedSubscriber } from "@/application/use-cases/notification/notify-dispute-created.subscriber";
import { NotifyDisputeMessageAddedSubscriber } from "@/application/use-cases/notification/notify-dispute-message-added.subscriber";
import { NotifyDisputeStatusChangeSubscriber } from "@/application/use-cases/notification/notify-dispute-status-change.subscriber";
import { NotifyProfessionalVerificationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-professional-verification-status-change.subscriber";
import { NotifySupportTicketStatusChangeSubscriber } from "@/application/use-cases/notification/notify-support-ticket-status-change.subscriber";

const notifications = new PrismaNotificationRepository();

/**
 * Module 37 — Domain Event Subscribers: registers this module's
 * `CompanyStatusChanged` notification subscriber against the shared
 * `eventBus`, at module load time — see `admin/compose.ts`'s sibling
 * registration and `infrastructure/events/compose.ts`'s own doc comment
 * for the pattern. Uses the same `NotificationServiceCreator` adapter
 * every other module's use cases are wired to (see that class's own doc
 * comment), not `CreateNotificationUseCase` directly, so this subscriber
 * goes through the identical channel-agnostic notify path as every other
 * notification call site in the codebase.
 */
eventBus.subscribe(CompanyStatusChanged, new NotifyCompanyStatusChangeSubscriber(new NotificationServiceCreator()));

/**
 * Module 37 — Domain Event Subscribers: registers this module's
 * `ProfessionalVerificationStatusChanged` notification subscriber against
 * the shared `eventBus` — same pattern as the `CompanyStatusChanged`
 * registration immediately above.
 */
eventBus.subscribe(
  ProfessionalVerificationStatusChanged,
  new NotifyProfessionalVerificationStatusChangeSubscriber(new NotificationServiceCreator()),
);

/**
 * Module 37 — Domain Event Subscribers: registers this module's
 * `CompanyVerificationStatusChanged` notification subscriber against the
 * shared `eventBus` — same pattern as the registrations immediately above.
 */
eventBus.subscribe(
  CompanyVerificationStatusChanged,
  new NotifyCompanyVerificationStatusChangeSubscriber(new NotificationServiceCreator()),
);

/**
 * Module 37 — Domain Event Subscribers: Dispute module (Module 21) — one
 * subscriber per event since assign/message/create genuinely don't share
 * DisputeStatusChanged's before/after-status shape (see each event's own
 * doc comment).
 */
eventBus.subscribe(DisputeStatusChanged, new NotifyDisputeStatusChangeSubscriber(new NotificationServiceCreator()));
eventBus.subscribe(DisputeAssigned, new NotifyDisputeAssignedSubscriber(new NotificationServiceCreator()));
eventBus.subscribe(DisputeMessageAdded, new NotifyDisputeMessageAddedSubscriber(new NotificationServiceCreator()));
eventBus.subscribe(DisputeCreated, new NotifyDisputeCreatedSubscriber(new NotificationServiceCreator()));

/**
 * Module 37 — Domain Event Subscribers: Support Ticket module (Module 21).
 */
eventBus.subscribe(
  SupportTicketStatusChanged,
  new NotifySupportTicketStatusChangeSubscriber(new NotificationServiceCreator()),
);

/**
 * Module 37 — Domain Event Subscribers: Company Invitation module (Module 18).
 */
eventBus.subscribe(
  CompanyInvitationStatusChanged,
  new NotifyCompanyInvitationStatusChangeSubscriber(new NotificationServiceCreator()),
);

/**
 * Module 37 — Domain Event Subscribers: Company Membership module (Module 18).
 */
eventBus.subscribe(
  CompanyMembershipChanged,
  new NotifyCompanyMembershipChangeSubscriber(new NotificationServiceCreator()),
);

/** Internal only — never wired to a public Server Action. See
 *  CreateNotificationUseCase's own doc comment. Exported for
 *  infrastructure/notifications/notification-service.ts (the
 *  NotificationCreator port implementation other modules call through)
 *  and for tests. */
export function makeCreateNotificationUseCase() {
  return new CreateNotificationUseCase(notifications);
}

export function makeListNotificationsUseCase() {
  return new ListNotificationsUseCase(notifications);
}

export function makeGetNotificationUseCase() {
  return new GetNotificationUseCase(notifications);
}

export function makeGetUnreadNotificationCountUseCase() {
  return new GetUnreadNotificationCountUseCase(notifications);
}

export function makeMarkNotificationAsReadUseCase() {
  return new MarkNotificationAsReadUseCase(notifications);
}

export function makeMarkAllNotificationsAsReadUseCase() {
  return new MarkAllNotificationsAsReadUseCase(notifications);
}

export function makeDismissNotificationUseCase() {
  return new DismissNotificationUseCase(notifications);
}
