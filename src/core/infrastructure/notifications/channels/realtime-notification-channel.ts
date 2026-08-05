import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
} from "@/application/ports/notification-channel";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * **Future-ready stub — not wired to any real-time transport.** No
 * WebSocket server, SSE endpoint, or third-party real-time provider
 * (Pusher/Ably/Socket.IO/etc.) exists anywhere in this codebase, and the
 * module instructions explicitly say not to introduce one here. This
 * class exists purely so `NotificationChannel = "REALTIME"` is a real,
 * requestable value today, and so a future module can add a live
 * transport by implementing this exact `NotificationChannelAdapter`
 * interface (e.g. pushing to a connected client's socket/SSE stream, or
 * publishing to a pub/sub channel a client subscription then relays) and
 * swapping it in at `notification-dispatcher.compose.ts` — no port,
 * dispatcher, or call-site change required.
 *
 * `send` intentionally does nothing but log — never throws.
 */
export class RealTimeNotificationChannel implements NotificationChannelAdapter {
  readonly channel: NotificationChannel = "REALTIME";

  async send(payload: NotificationChannelPayload): Promise<void> {
    console.info(
      `RealTimeNotificationChannel: no-op (no real-time transport configured) — userId=${payload.userId}, type=${payload.type}.`,
    );
  }
}
