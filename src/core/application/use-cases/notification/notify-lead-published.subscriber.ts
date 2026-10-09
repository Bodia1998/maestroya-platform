import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { LeadPublished } from "@/domain/events/lead-published";
import type { LeadNotificationContextReader } from "@/domain/repositories/lead-notification-context-reader";
import { customerLeadRequestPath } from "@/domain/services/lead-notification";
import { sendLeadNotification } from "@/application/use-cases/notification/lead-notification-sender";

/**
 * Module 145 — tells the request's CUSTOMER that their LEAD_V1 request is live.
 *
 * Reacts to `LeadPublished` (raised only when M133's PublishLeadUseCase actually moved the
 * lead DRAFT -> PUBLISHED). The event carries only the lead id: the recipient is the
 * persisted owner of the lead's ServiceRequest, the reader returns null for anything that
 * is not LEAD_V1, and the lead must still be PUBLISHED. Idempotent per lead.
 */
export class NotifyLeadPublishedSubscriber implements EventHandler<LeadPublished> {
  constructor(
    private readonly contexts: LeadNotificationContextReader,
    private readonly notifications: NotificationCreator,
  ) {}

  async handle(event: LeadPublished): Promise<void> {
    const context = await this.contexts.findForLead(event.leadId);
    if (!context || context.leadStatus !== "PUBLISHED") return;

    await sendLeadNotification(this.notifications, {
      fact: "LEAD_PUBLISHED",
      subjectId: context.leadId,
      role: "customer",
      recipientUserId: context.customerUserId,
      city: context.city,
      actionUrl: customerLeadRequestPath(context.serviceRequestId),
    });
  }
}
