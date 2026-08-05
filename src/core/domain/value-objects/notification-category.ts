/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * A channel-agnostic severity/intent classification for a notification,
 * independent of the (in-app-only, today) `NotificationTypeValue` enum in
 * `domain/repositories/notification-repository.ts`. `NotificationTypeValue`
 * says *what happened* ("QUOTE_ACCEPTED"); `NotificationCategory` says
 * *how urgently the recipient should treat it* — used by presentation-layer
 * code (e.g. which ARIA live-region politeness level to render a toast
 * with) and by channel adapters (e.g. a future push provider choosing a
 * priority level) without either of them needing to know the full
 * `NotificationTypeValue` switch.
 *
 * Pure domain value object — no Prisma model/enum backs this, and none is
 * needed: it is derived at the call site, never persisted.
 */
export const NOTIFICATION_CATEGORIES = [
  "SUCCESS",
  "WARNING",
  "ERROR",
  "INFORMATION",
  "SYSTEM",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === "string" && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}
