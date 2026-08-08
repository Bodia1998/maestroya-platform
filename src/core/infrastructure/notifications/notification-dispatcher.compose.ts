import { ResendEmailSender } from "@/infrastructure/email/resend-email-sender";
import { env } from "@/infrastructure/config/env";
import { InAppNotificationChannel } from "@/infrastructure/notifications/channels/in-app-notification-channel";
import { EmailNotificationChannel } from "@/infrastructure/notifications/channels/email-notification-channel";
import { WebPushNotificationChannel } from "@/infrastructure/notifications/channels/web-push-notification-channel";
import { RealTimeNotificationChannel } from "@/infrastructure/notifications/channels/realtime-notification-channel";
import { SmsNotificationChannel } from "@/infrastructure/notifications/channels/sms-notification-channel";
import { NotificationDispatcher } from "@/infrastructure/notifications/notification-dispatcher";
import type { NotificationService } from "@/application/ports/notification-service";
import { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";
import { realtimeHub } from "@/infrastructure/realtime/compose";
import { deferredSmsQueue } from "@/infrastructure/sms/compose";
import { getTracer } from "@/infrastructure/tracing/compose";
import {
  withEmailTracing,
  withNotificationChannelTracing,
} from "@/infrastructure/tracing/traced-external-senders";

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
 *   - `WEB_PUSH` — future-ready no-op stub (see its own doc comment) —
 *     requestable today, harmless, not wired to any provider.
 *   - `REALTIME` — real as of Module 48 — Real-Time System: publishes onto
 *     the recipient's `user:{id}` realtime channel via the shared
 *     `RealtimeHub` (`infrastructure/realtime/compose.ts`). See
 *     `RealTimeNotificationChannel`'s own doc comment.
 *   - `SMS` — real as of Module 49 — SMS Notifications: enqueues onto the
 *     `sms-dispatch` background-job queue (`infrastructure/sms/
 *     compose.ts`), never sends synchronously — see
 *     `SmsNotificationChannel`'s own doc comment for why. Wired via
 *     `deferredSmsQueue`, not `getSmsQueue()` directly, so importing this
 *     file never eagerly constructs the SMS worker (the identical
 *     laziness `deferredSmsQueue`'s own doc comment explains).
 *
 * A single module-level instance (`notificationService`) is exported and
 * reused — the dispatcher and its adapters are stateless, so there is no
 * benefit to constructing a fresh one per call, mirroring how
 * `auth/compose.ts` keeps a single `emailSender` at module scope.
 */
/**
 * Module 51 — Distributed Tracing: both wrappers below are decorators
 * over the *unmodified* `EmailSender`/`NotificationChannelAdapter`
 * interfaces and return their argument untouched when tracing is
 * disabled — no channel, the dispatcher, or any caller changes. The
 * `REALTIME` adapter is wrapped specifically because it is this
 * platform's outbound realtime-gateway boundary (see
 * `RealTimeNotificationChannel`); the same decorator would apply to the
 * other channels, but `IN_APP` is already covered by Prisma tracing,
 * `SMS` by the queue/`fetch` spans, and `WEB_PUSH` is a no-op stub — so
 * only the two that would otherwise be invisible are wrapped.
 */
const emailSender = withEmailTracing(new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM), getTracer());

export const notificationService: NotificationService = new NotificationDispatcher([
  new InAppNotificationChannel(),
  new EmailNotificationChannel(emailSender),
  new WebPushNotificationChannel(),
  withNotificationChannelTracing(
    new RealTimeNotificationChannel(new PublishToChannelUseCase(realtimeHub)),
    getTracer(),
  ),
  new SmsNotificationChannel(deferredSmsQueue),
]);

export function makeNotificationService(): NotificationService {
  return notificationService;
}
