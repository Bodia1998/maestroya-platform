import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
} from "@/application/ports/notification-channel";
import { RealtimeChannel } from "@/domain/value-objects/realtime-channel";
import type { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";

/**
 * Module 32 originally shipped this as a documented no-op stub — "no
 * real-time transport exists yet". Module 48 — Real-Time System is that
 * transport, so this class now does real work: it publishes the
 * notification onto the recipient's own `user:{userId}` channel via
 * `PublishToChannelUseCase`, which fans it out to every live SSE/WebSocket
 * connection that user currently has subscribed (see
 * `ChannelAuthorizationService` — only the user themselves, or staff, can
 * ever subscribe to that channel, so "notifications are routed only to
 * authorized recipients" holds automatically here too).
 *
 * The port (`NotificationChannelAdapter`) and dispatcher
 * (`NotificationDispatcher`) are completely unchanged — this is still the
 * exact adapter the original stub's doc comment promised a future module
 * would provide, swapped in at `notification-dispatcher.compose.ts` with
 * no signature change anywhere. `send` still never throws (a user with no
 * live connection is simply not delivered to right now — same best-effort
 * contract as before), preserving the "adapters do not swallow errors
 * themselves" note in `NotificationChannelAdapter`'s own doc comment: this
 * only means "no live connection", never a real failure to report.
 */
export class RealTimeNotificationChannel implements NotificationChannelAdapter {
  readonly channel: NotificationChannel = "REALTIME";

  constructor(private readonly publishToChannel: PublishToChannelUseCase) {}

  async send(payload: NotificationChannelPayload): Promise<void> {
    const channel = RealtimeChannel.of("user", payload.userId);
    this.publishToChannel.execute({
      channel: channel.toString(),
      type: "notification",
      payload: {
        category: payload.category,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        resourceType: payload.resourceType ?? null,
        resourceId: payload.resourceId ?? null,
        actionUrl: payload.actionUrl ?? null,
        metadata: payload.metadata ?? null,
      },
    });
  }
}
