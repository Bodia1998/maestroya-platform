import type {
  NotificationChannel,
  NotificationChannelAdapter,
} from "@/application/ports/notification-channel";
import type { NotificationRequest, NotificationService } from "@/application/ports/notification-service";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * The only implementation of `NotificationService`: fans a single
 * `notify()` call out to every adapter registered for the requested
 * channels (default `["IN_APP"]`, see `NotificationRequest`'s own doc
 * comment). Deliberately minimal — a plain `Map` lookup, no event bus, no
 * queue, no retry policy, same scope discipline as `NotificationCreator`/
 * `AppointmentNotifier`/`JobNotifier`.
 *
 * Channels run sequentially and independently: if one channel's adapter
 * throws, the remaining requested channels still run (a failed email must
 * never prevent the in-app row from being written, and vice versa). All
 * failures are collected and re-thrown together at the end so callers that
 * `try/catch` around `notify()` (the existing, mandatory convention — see
 * `NotificationChannelAdapter`'s own doc comment) still observe a failure
 * and can log it, while every channel that *could* succeed, did.
 *
 * A channel requested with no adapter registered (e.g. `WEB_PUSH`/`REALTIME`
 * before a real provider is wired in) is a silent no-op by design — the
 * stub adapters registered by `notification-dispatcher.compose.ts` already
 * make this explicit, but the dispatcher itself tolerates an unregistered
 * channel too, so a future caller requesting a not-yet-wired channel never
 * crashes the primary operation that triggered it.
 */
export class NotificationDispatcher implements NotificationService {
  private readonly adapters: Map<NotificationChannel, NotificationChannelAdapter>;

  constructor(adapters: NotificationChannelAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.channel, adapter]));
  }

  async notify(request: NotificationRequest): Promise<void> {
    const channels = request.channels ?? ["IN_APP"];
    const errors: unknown[] = [];

    for (const channel of channels) {
      const adapter = this.adapters.get(channel);
      if (!adapter) continue;

      try {
        await adapter.send({
          userId: request.userId,
          email: request.email,
          phone: request.phone,
          locale: request.locale,
          category: request.category,
          type: request.type,
          title: request.title,
          message: request.message,
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          actionUrl: request.actionUrl,
          metadata: request.metadata,
        });
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  }
}
