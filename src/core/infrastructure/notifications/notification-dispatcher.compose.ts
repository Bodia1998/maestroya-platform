import { ResendEmailSender } from "@/infrastructure/email/resend-email-sender";
import { env } from "@/infrastructure/config/env";
import { InAppNotificationChannel } from "@/infrastructure/notifications/channels/in-app-notification-channel";
import { EmailNotificationChannel } from "@/infrastructure/notifications/channels/email-notification-channel";
import { WebPushNotificationChannel } from "@/infrastructure/notifications/channels/web-push-notification-channel";
import { RealTimeNotificationChannel } from "@/infrastructure/notifications/channels/realtime-notification-channel";
import { NotificationDispatcher } from "@/infrastructure/notifications/notification-dispatcher";
import type { NotificationService } from "@/application/ports/notification-service";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * Composition root for the channel-agnostic `NotificationService` — same
 * manual-composition convention as every other `compose.ts` in this
 * codebase (no DI container). Registers all four channels:
 *
 *   - `IN_APP` — real, backed by the existing Module 15 Notification
 *     table (`InAppNotificationChannel`).
 *   - `EMAIL` — real, reuses the existing `ResendEmailSender`/
 *     `EmailSender` port also used by `auth/compose.ts`
 *     (`EmailNotificationChannel`). Wired here independently of
 *     `auth/compose.ts`'s own `ResendEmailSender` instance — both are
 *     stateless and cheap to construct, and keeping them separate avoids
 *     introducing a cross-module import between Auth and Notifications
 *     purely to share one object.
 *   - `WEB_PUSH` / `REALTIME` — future-ready no-op stubs (see their own doc
 *     comments) — requestable today, harmless, not wired to any provider.
 *
 * A single module-level instance (`notificationService`) is exported and
 * reused — the dispatcher and its adapters are stateless, so there is no
 * benefit to constructing a fresh one per call, mirroring how
 * `auth/compose.ts` keeps a single `emailSender` at module scope.
 */
const emailSender = new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);

export const notificationService: NotificationService = new NotificationDispatcher([
  new InAppNotificationChannel(),
  new EmailNotificationChannel(emailSender),
  new WebPushNotificationChannel(),
  new RealTimeNotificationChannel(),
]);

export function makeNotificationService(): NotificationService {
  return notificationService;
}
