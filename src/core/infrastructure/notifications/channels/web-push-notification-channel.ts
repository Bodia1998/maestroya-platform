import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
} from "@/application/ports/notification-channel";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * **Future-ready stub — not wired to any web push provider.** No Web Push
 * (VAPID/Push API) integration exists anywhere in this codebase, and none is
 * added by this module (installing a web push SDK/registering browser push
 * subscriptions/standing up a provider account is a separate, later piece of
 * work, not part of "add the abstraction"). This class exists so:
 *
 *   1. `NotificationChannel = "WEB_PUSH"` is a real, requestable value today
 *      without every caller needing an `if` to check whether it's
 *      supported yet.
 *   2. A future module can implement a real web push provider by writing one
 *      new class satisfying this exact `NotificationChannelAdapter`
 *      interface and swapping it in at the composition root
 *      (`notification-dispatcher.compose.ts`) — no port, dispatcher, or
 *      call-site change required.
 *
 * `send` intentionally does nothing but log — never throws, so requesting
 * the `WEB_PUSH` channel today is harmless rather than a crash.
 */
export class WebPushNotificationChannel implements NotificationChannelAdapter {
  readonly channel: NotificationChannel = "WEB_PUSH";

  async send(payload: NotificationChannelPayload): Promise<void> {
    console.info(
      `WebPushNotificationChannel: no-op (no web push provider configured) — userId=${payload.userId}, type=${payload.type}.`,
    );
  }
}
