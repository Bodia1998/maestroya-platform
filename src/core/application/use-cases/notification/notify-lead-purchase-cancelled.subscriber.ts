import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { LeadPurchaseCancelled } from "@/domain/events/lead-purchase-cancelled";
import type { LeadNotificationContextReader } from "@/domain/repositories/lead-notification-context-reader";
import { REQUIRED_PURCHASE_STATUS_FOR_FACT, professionalLeadPurchasePath } from "@/domain/services/lead-notification";
import { sendLeadNotification } from "@/application/use-cases/notification/lead-notification-sender";

/**
 * Module 145 — tells the BUYING PROFESSIONAL that their payment attempt was cancelled and no
 * access was granted. The customer is deliberately not told (their request is unaffected).
 *
 * Reacts to `LeadPurchaseCancelled` (M141, verified `payment_intent.canceled` on a PENDING_PAYMENT
 * purchase). Re-reads the purchase and requires CANCELLED; recipient is the persisted professional
 * owner. Idempotent per purchase.
 */
export class NotifyLeadPurchaseCancelledSubscriber implements EventHandler<LeadPurchaseCancelled> {
  constructor(
    private readonly contexts: LeadNotificationContextReader,
    private readonly notifications: NotificationCreator,
  ) {}

  async handle(event: LeadPurchaseCancelled): Promise<void> {
    const context = await this.contexts.findForPurchase(event.purchaseId);
    if (!context || context.purchaseStatus !== REQUIRED_PURCHASE_STATUS_FOR_FACT.PURCHASE_CANCELLED) return;

    await sendLeadNotification(this.notifications, {
      fact: "PURCHASE_CANCELLED",
      subjectId: event.purchaseId,
      role: "professional",
      recipientUserId: context.professionalUserId,
      city: context.city,
      actionUrl: professionalLeadPurchasePath(context.leadId),
    });
  }
}
