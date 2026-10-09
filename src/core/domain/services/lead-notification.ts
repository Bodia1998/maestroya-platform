import type { NotificationTypeValue } from "@/domain/repositories/notification-repository";
import type { NotificationCategory } from "@/domain/value-objects/notification-category";

/**
 * Module 145 — pure LEAD_V1 notification policy: which notification each
 * business fact produces, for whom, with which idempotency key, and what safe
 * metadata it may carry. No I/O, no framework.
 *
 * Business facts (each one authoritative in exactly one place):
 *   LEAD_PUBLISHED            M133 PublishLeadUseCase (DRAFT -> PUBLISHED)
 *   PURCHASE_CONFIRMED        M141 webhook (PENDING_PAYMENT -> CONFIRMED)
 *   PURCHASE_CANCELLED        M141 webhook (PENDING_PAYMENT -> CANCELLED)
 *
 * One fact => one notification PER RECIPIENT ROLE, so "contact access becomes
 * available" is deliberately NOT a separate notification from "purchase
 * confirmed" (M138 derives access from CONFIRMED; they are the same instant).
 */
export const LEAD_NOTIFICATION_FACTS = ["LEAD_PUBLISHED", "PURCHASE_CONFIRMED", "PURCHASE_CANCELLED"] as const;
export type LeadNotificationFact = (typeof LEAD_NOTIFICATION_FACTS)[number];

export const LEAD_NOTIFICATION_RECIPIENT_ROLES = ["customer", "professional"] as const;
export type LeadNotificationRecipientRole = (typeof LEAD_NOTIFICATION_RECIPIENT_ROLES)[number];

export interface LeadNotificationSpec {
  type: NotificationTypeValue;
  category: NotificationCategory;
}

/** The only (fact, role) pairs that notify. Anything else is intentionally silent. */
const SPECS: Readonly<Record<string, LeadNotificationSpec>> = {
  "LEAD_PUBLISHED:customer": { type: "LEAD_REQUEST_PUBLISHED", category: "SUCCESS" },
  "PURCHASE_CONFIRMED:customer": { type: "LEAD_PURCHASED", category: "INFORMATION" },
  "PURCHASE_CONFIRMED:professional": { type: "LEAD_PURCHASE_CONFIRMED", category: "SUCCESS" },
  "PURCHASE_CANCELLED:professional": { type: "LEAD_PURCHASE_CANCELLED", category: "WARNING" },
};

export function leadNotificationSpec(fact: LeadNotificationFact, role: LeadNotificationRecipientRole): LeadNotificationSpec | null {
  return SPECS[`${fact}:${role}`] ?? null;
}

/**
 * Idempotency key: one per (business fact, subject, recipient role). The subject is
 * the lead for publication and the purchase for payment outcomes. It is stored in
 * the internal `Notification.dedupeKey` column (unique with the recipient) and is
 * never sent to the browser or rendered into any text.
 */
export function leadNotificationDedupeKey(fact: LeadNotificationFact, subjectId: string, role: LeadNotificationRecipientRole): string {
  return `lead-v1:${fact.toLowerCase().replace(/_/g, "-")}:${subjectId}:${role}`;
}

/** Purchase status each purchase-outcome fact requires at notification time. */
export const REQUIRED_PURCHASE_STATUS_FOR_FACT = {
  PURCHASE_CONFIRMED: "CONFIRMED",
  PURCHASE_CANCELLED: "CANCELLED",
} as const;

/** Safe, whitelisted metadata for the localized templates (`{city}` only). */
export interface LeadNotificationMetadata {
  city: string;
}

export function buildLeadNotificationMetadata(input: { city: string }): LeadNotificationMetadata {
  return { city: input.city.trim() };
}

/** Same-origin deep links. The professional link is the M144 checkout page, which re-derives access from the authoritative purchase state. */
export function customerLeadRequestPath(serviceRequestId: string): string {
  return `/requests/${encodeURIComponent(serviceRequestId)}`;
}

export function professionalLeadPurchasePath(leadId: string): string {
  return `/dashboard/professional/leads/${encodeURIComponent(leadId)}/purchase`;
}
