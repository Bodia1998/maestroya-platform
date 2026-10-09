import type { NotificationCreator } from "@/application/ports/notification-creator";
import {
  buildLeadNotificationMetadata,
  leadNotificationDedupeKey,
  leadNotificationSpec,
  type LeadNotificationFact,
  type LeadNotificationRecipientRole,
} from "@/domain/services/lead-notification";
import type { NotificationTypeValue } from "@/domain/repositories/notification-repository";

/**
 * Module 145 — the stored (English) title/message of each LEAD_V1 notification type.
 * Same convention as every other subscriber: the persisted text is the audit/fallback
 * text; what the reader sees is rendered from `notificationTemplates.<TYPE>` in their
 * language (Module 120), with the `{city}` argument taken from the safe metadata. These
 * strings must stay identical to the `en` templates (a unit test enforces it).
 *
 * Deliberately generic: no customer name/phone/email/address, no request title or
 * description (free text), no professional identity, no price, no payment or purchase id.
 */
export function leadNotificationEnglishText(type: NotificationTypeValue, city: string): { title: string; message: string } {
  switch (type) {
    case "LEAD_REQUEST_PUBLISHED":
      return {
        title: "Your request is live",
        message: `Your service request in ${city} has been published and professionals can now see it.`,
      };
    case "LEAD_PURCHASED":
      return {
        title: "A professional unlocked your request",
        message: `A professional has purchased access to your service request in ${city} and may contact you soon.`,
      };
    case "LEAD_PURCHASE_CONFIRMED":
      return {
        title: "Payment confirmed",
        message: `Your payment for the lead in ${city} is confirmed. You can now view the customer's contact details.`,
      };
    case "LEAD_PURCHASE_CANCELLED":
      return {
        title: "Payment attempt cancelled",
        message: `Your payment attempt for the lead in ${city} was cancelled and no access was granted. You can start a new purchase if the lead is still available.`,
      };
    default:
      throw new Error(`Not a LEAD_V1 notification type: ${String(type)}`);
  }
}

export interface LeadNotificationDelivery {
  fact: LeadNotificationFact;
  /** The id the dedupe key is scoped to: the lead for publication, the purchase for payment outcomes. Never rendered. */
  subjectId: string;
  role: LeadNotificationRecipientRole;
  /** A User.id resolved from persisted relations — never from an event payload. */
  recipientUserId: string;
  city: string;
  actionUrl: string;
}

/**
 * Sends ONE LEAD_V1 notification for (fact, subject, role). Idempotent: the dedupe key
 * makes a repeated/concurrent call a no-op on every channel (see NotificationDispatcher).
 * Channels are the platform default (in-app + realtime); EMAIL is intentionally not
 * requested (see the Module 145 doc).
 */
export async function sendLeadNotification(notifications: NotificationCreator, delivery: LeadNotificationDelivery): Promise<void> {
  const spec = leadNotificationSpec(delivery.fact, delivery.role);
  if (!spec) return; // this (fact, role) pair is intentionally silent

  const text = leadNotificationEnglishText(spec.type, delivery.city);
  await notifications.notify({
    userId: delivery.recipientUserId,
    type: spec.type,
    category: spec.category,
    title: text.title,
    message: text.message,
    resourceType: null,
    resourceId: null,
    actionUrl: delivery.actionUrl,
    metadata: { ...buildLeadNotificationMetadata({ city: delivery.city }) },
    channels: ["IN_APP", "REALTIME"],
    dedupeKey: leadNotificationDedupeKey(delivery.fact, delivery.subjectId, delivery.role),
  });
}
