import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
} from "@/application/ports/notification-channel";
import type { SmsQueue } from "@/application/ports/sms-queue";

/**
 * Module 49 — SMS Notifications.
 *
 * `SMS` channel adapter: the SMS module's counterpart to
 * `EmailNotificationChannel`, except it never calls a provider directly —
 * it only enqueues onto `SmsQueue` (backed by the Module 45 background-job
 * queue; see that port's own doc comment for why synchronous sending from
 * inside `NotificationDispatcher.notify()` would be wrong). The actual
 * `SmsSender.send()` call — with retries, backoff, and dead-lettering —
 * happens later, in the SMS dispatch worker
 * (`infrastructure/sms/sms-dispatch-job-processor.ts`).
 *
 * If no recipient phone number is available, this is a safe no-op
 * (logged, not thrown) — the identical contract `EmailNotificationChannel`
 * already has for a missing `email`: the caller may not always have
 * resolved a phone number, and that must never fail the primary operation
 * that triggered the notification.
 *
 * A failed *enqueue* (the job store itself unreachable) is also swallowed
 * here rather than thrown — `NotificationDispatcher` already collects and
 * re-throws channel errors for its caller to log (see that class's own
 * doc comment), but an SMS being undeliverable-right-now must never
 * prevent the `IN_APP`/`REALTIME`/`EMAIL` channels in the same `notify()`
 * call from succeeding. This mirrors `EnqueueSearchIndexSubscriber`'s own
 * "a failed enqueue never fails the write" reasoning exactly, applied to
 * notification delivery instead of search indexing.
 */
export class SmsNotificationChannel implements NotificationChannelAdapter {
  readonly channel: NotificationChannel = "SMS";

  constructor(private readonly queue: SmsQueue) {}

  async send(payload: NotificationChannelPayload): Promise<void> {
    if (!payload.phone) {
      console.warn(
        `SmsNotificationChannel: skipped — no recipient phone for userId=${payload.userId}, type=${payload.type}.`,
      );
      return;
    }

    try {
      await this.queue.enqueue({
        userId: payload.userId,
        phone: payload.phone,
        type: payload.type,
        fallbackMessage: payload.message,
        locale: payload.locale,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId,
        metadata: payload.metadata,
      });
    } catch (error) {
      console.error(
        `SmsNotificationChannel: failed to enqueue SMS for userId=${payload.userId}, type=${payload.type}.`,
        error,
      );
    }
  }
}
