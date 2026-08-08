/**
 * Module 49 — SMS Notifications.
 *
 * The seam `SmsNotificationChannel` uses to say "send this SMS" without
 * knowing anything about queues, workers, or the SMS provider itself —
 * the exact same role `SearchIndexQueue`
 * (`application/ports/search-index-queue.ts`) plays for the search
 * indexing pipeline, and for the identical reason: the platform's default
 * `SynchronousEventBus`/`NotificationDispatcher` call path runs a channel
 * adapter's `send()` inline, inside the HTTP request that triggered the
 * notification. An adapter that called `SmsSender.send()` directly would
 * be making a live Twilio network call inside that request and would fail
 * (or slow) it whenever Twilio is briefly slow or down — exactly the
 * failure mode `SearchIndexQueue`'s own doc comment describes for a
 * subscriber that indexed synchronously.
 *
 * `SmsNotificationChannel` can only reach this port, so it cannot
 * accidentally send synchronously. The actual `SmsSender` call happens
 * later, in the SMS dispatch background worker
 * (`infrastructure/sms/sms-dispatch-job-processor.ts`), where Module 45's
 * retries, backoff, and dead-lettering apply.
 *
 * The implementation (`infrastructure/sms/sms-queue-adapter.ts`) is a thin
 * adapter over a Module 45 `Queue` — no second queue implementation is
 * introduced by this module.
 */
export interface SmsDispatchRequest {
  userId: string;
  /** E.164 recipient phone number. */
  phone: string;
  /** The notification type driving template selection — see
   *  `infrastructure/sms/sms-template-mapping.ts`. */
  type: string;
  /** Fallback plain-text body used when `type` has no registered SMS
   *  template (see `mapNotificationTypeToSmsTemplate`'s own doc comment) —
   *  the same `NotificationChannelPayload.message` every other channel
   *  already receives. */
  fallbackMessage: string;
  locale?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SmsQueue {
  /**
   * Schedules the SMS. Resolves as soon as the job is durably enqueued —
   * never once the SMS has actually been sent.
   *
   * Implementations must not throw for an already-scheduled duplicate.
   * They *may* throw if the job store itself is unreachable; callers
   * (`SmsNotificationChannel`) treat that as non-fatal — a failed enqueue
   * must never fail the primary operation that triggered the
   * notification, mirroring every other `NotificationChannelAdapter`'s
   * own contract.
   */
  enqueue(request: SmsDispatchRequest): Promise<void>;
}
