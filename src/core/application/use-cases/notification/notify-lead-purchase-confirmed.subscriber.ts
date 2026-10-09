import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { LeadPurchaseConfirmed } from "@/domain/events/lead-purchase-confirmed";
import type { LeadNotificationContextReader } from "@/domain/repositories/lead-notification-context-reader";
import {
  REQUIRED_PURCHASE_STATUS_FOR_FACT,
  customerLeadRequestPath,
  professionalLeadPurchasePath,
} from "@/domain/services/lead-notification";
import { sendLeadNotification } from "@/application/use-cases/notification/lead-notification-sender";

/**
 * Module 145 — the authoritative-payment notifications, one per recipient:
 *   - the BUYING PROFESSIONAL: "payment confirmed, contact details available" (this is also
 *     the single "contact access is available" notification — M138 derives access from
 *     CONFIRMED, so it is the same instant and deliberately not a second notification);
 *   - the request's CUSTOMER: "a professional unlocked your request" (no identity, no price).
 *
 * Reacts to `LeadPurchaseConfirmed`, which only the M141 webhook use case raises. The event
 * carries the purchase id only; this handler re-reads the purchase and requires CONFIRMED, so
 * even a mis-published event for a PENDING_PAYMENT / FAILED / CANCELLED purchase notifies
 * nobody. Recipients are the persisted professional owner and request owner. Each recipient is
 * attempted independently (one failure does not suppress the other) and both are idempotent per
 * purchase, so the webhook's re-observation of an already-confirmed purchase is harmless.
 */
export class NotifyLeadPurchaseConfirmedSubscriber implements EventHandler<LeadPurchaseConfirmed> {
  constructor(
    private readonly contexts: LeadNotificationContextReader,
    private readonly notifications: NotificationCreator,
  ) {}

  async handle(event: LeadPurchaseConfirmed): Promise<void> {
    const context = await this.contexts.findForPurchase(event.purchaseId);
    if (!context || context.purchaseStatus !== REQUIRED_PURCHASE_STATUS_FOR_FACT.PURCHASE_CONFIRMED) return;

    const failures: unknown[] = [];
    const attempts: Array<() => Promise<void>> = [
      () =>
        sendLeadNotification(this.notifications, {
          fact: "PURCHASE_CONFIRMED",
          subjectId: event.purchaseId,
          role: "professional",
          recipientUserId: context.professionalUserId,
          city: context.city,
          actionUrl: professionalLeadPurchasePath(context.leadId),
        }),
      () =>
        sendLeadNotification(this.notifications, {
          fact: "PURCHASE_CONFIRMED",
          subjectId: event.purchaseId,
          role: "customer",
          recipientUserId: context.customerUserId,
          city: context.city,
          actionUrl: customerLeadRequestPath(context.serviceRequestId),
        }),
    ];
    for (const attempt of attempts) {
      try {
        await attempt();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }
}
