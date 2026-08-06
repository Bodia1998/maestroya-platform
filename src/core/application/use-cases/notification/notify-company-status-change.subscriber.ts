import type { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

const NOTIFICATION_FOR_NEW_STATUS: Record<
  CompanyStatusChanged["newStatus"],
  Pick<NotificationEvent, "type" | "title" | "message">
> = {
  SUSPENDED: {
    type: "COMPANY_SUSPENDED",
    title: "Your company has been suspended",
    message: "Your company profile has been suspended by a platform administrator.",
  },
  ACTIVE: {
    type: "COMPANY_REACTIVATED",
    title: "Your company has been reactivated",
    message: "Your company profile is active again.",
  },
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `CompanyStatusChanged`
 * (`domain/events/company-status-changed.ts`). Reacts to the event by
 * calling the existing `NotificationCreator` port — the same
 * `notify(...)` call `SuspendCompanyUseCase`/`ReactivateCompanyUseCase`
 * used to make directly, wrapped in their own local `try/catch`. No
 * business logic here: `NOTIFICATION_FOR_NEW_STATUS` is a straight
 * translation table from the event's `newStatus` to the title/message
 * those two use cases already used, byte for byte.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`,
 * following the exact registration pattern documented on
 * `infrastructure/events/compose.ts`.
 *
 * Unlike the old inline `try/catch { console.error(...) }`, this
 * subscriber does *not* swallow its own failure — it lets a thrown error
 * propagate to `SynchronousEventBus`, which is what turns it into an
 * `EventDispatchError` the publishing use case can report through
 * `FailureReporter` (`application/ports/failure-reporter.ts`). Swallowing
 * here as well would just be a second, redundant place failures could get
 * lost.
 */
export class NotifyCompanyStatusChangeSubscriber implements EventHandler<CompanyStatusChanged> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: CompanyStatusChanged): Promise<void> {
    const { type, title, message } = NOTIFICATION_FOR_NEW_STATUS[event.newStatus];
    await this.notifications.notify({
      userId: event.ownerUserId,
      type,
      title,
      message,
      resourceType: "COMPANY",
      resourceId: event.companyId,
    });
  }
}
