import type { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

const NOTIFICATION_FOR_TRANSITION: Record<
  CompanyVerificationStatusChanged["transition"],
  Pick<NotificationEvent, "type" | "title" | "message">
> = {
  SUBMITTED: {
    type: "COMPANY_VERIFICATION_SUBMITTED",
    title: "Verification request submitted",
    message: "We have received your company's verification request and will review it shortly.",
  },
  RESUBMITTED: {
    type: "COMPANY_VERIFICATION_SUBMITTED",
    title: "Verification request resubmitted",
    message: "We have received your company's updated verification request.",
  },
  APPROVED: {
    type: "COMPANY_VERIFICATION_APPROVED",
    title: "Your company is now verified",
    message: "Your company's verification has been approved. A verified badge now appears on its public profile.",
  },
  REJECTED: {
    type: "COMPANY_VERIFICATION_REJECTED",
    title: "Verification request rejected",
    message: "Your company's verification request was rejected. See the details for the reason.",
  },
  RESUBMISSION_REQUESTED: {
    type: "COMPANY_VERIFICATION_RESUBMISSION_REQUIRED",
    title: "Resubmission required",
    message: "Your company's verification request needs changes before it can be approved.",
  },
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `CompanyVerificationStatusChanged`
 * (`domain/events/company-verification-status-changed.ts`) — mirrors
 * `NotifyProfessionalVerificationStatusChangeSubscriber` exactly. No
 * business logic here: `NOTIFICATION_FOR_TRANSITION` is a straight
 * translation table from the event's `transition` to the title/message the
 * five company-verification use cases used to build inline.
 *
 * A `null` `recipientUserId` (the defensive "company not found" edge case
 * on the admin-side transitions) is a no-op, not an error — the
 * pre-Module-37 use cases silently skipped the notification in that case
 * too (while still recording the audit entry via the sibling subscriber).
 */
export class NotifyCompanyVerificationStatusChangeSubscriber
  implements EventHandler<CompanyVerificationStatusChanged>
{
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: CompanyVerificationStatusChanged): Promise<void> {
    if (!event.recipientUserId) return;

    const { type, title, message } = NOTIFICATION_FOR_TRANSITION[event.transition];
    await this.notifications.notify({
      userId: event.recipientUserId,
      type,
      title,
      message,
      resourceType: "COMPANY_VERIFICATION",
      resourceId: event.verificationId,
      actionUrl: "/dashboard/company/verification",
    });
  }
}
