import type { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

const NOTIFICATION_FOR_TRANSITION: Record<
  ProfessionalVerificationStatusChanged["transition"],
  Pick<NotificationEvent, "type" | "title" | "message">
> = {
  SUBMITTED: {
    type: "VERIFICATION_SUBMITTED",
    title: "Verification request submitted",
    message: "We have received your verification request and will review it shortly.",
  },
  RESUBMITTED: {
    type: "VERIFICATION_SUBMITTED",
    title: "Verification request resubmitted",
    message: "We have received your updated verification request and will review it shortly.",
  },
  APPROVED: {
    type: "VERIFICATION_APPROVED",
    title: "You are now a verified professional",
    message: "Your verification has been approved. A verified badge now appears on your public profile.",
  },
  REJECTED: {
    type: "VERIFICATION_REJECTED",
    title: "Verification request rejected",
    message: "Your verification request was rejected. Open your verification page to see why and try again.",
  },
  RESUBMISSION_REQUESTED: {
    type: "VERIFICATION_RESUBMISSION_REQUIRED",
    title: "More information needed for verification",
    message: "A reviewer has asked you to update your verification request. Open your verification page for details.",
  },
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `ProfessionalVerificationStatusChanged`
 * (`domain/events/professional-verification-status-changed.ts`) — mirrors
 * `NotifyCompanyStatusChangeSubscriber` exactly. Reacts to the event by
 * calling the existing `NotificationCreator` port — the same `notify(...)`
 * call the five verification use cases used to make directly, each wrapped
 * in their own local `try/catch { console.error(...) }`. No business logic
 * here: `NOTIFICATION_FOR_TRANSITION` is a straight translation table from
 * the event's `transition` to the title/message those use cases already
 * used, byte for byte.
 *
 * A `null` `professionalUserId` (the defensive "profile not found" edge
 * case — see the event's own doc comment) is a no-op, not an error: the
 * pre-Module-37 use cases silently skipped the notification in that case
 * too (while still recording the audit entry via the sibling subscriber).
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 * Unlike the old inline `try/catch`, this subscriber does *not* swallow
 * its own failure — it lets a thrown error propagate to
 * `SynchronousEventBus`, which turns it into an `EventDispatchError` the
 * publishing use case reports through `FailureReporter`.
 */
export class NotifyProfessionalVerificationStatusChangeSubscriber
  implements EventHandler<ProfessionalVerificationStatusChanged>
{
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: ProfessionalVerificationStatusChanged): Promise<void> {
    if (!event.professionalUserId) return;

    const { type, title, message } = NOTIFICATION_FOR_TRANSITION[event.transition];
    await this.notifications.notify({
      userId: event.professionalUserId,
      type,
      title,
      message,
      resourceType: "PROFESSIONAL_VERIFICATION",
      resourceId: event.verificationId,
      actionUrl: "/dashboard/professional/verification",
    });
  }
}
