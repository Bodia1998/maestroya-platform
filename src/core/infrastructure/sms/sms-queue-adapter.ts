import type { SmsDispatchRequest, SmsQueue } from "@/application/ports/sms-queue";
import type { JobOptions } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";
import { smsDispatchJobId, type SmsDispatchJobData } from "@/infrastructure/sms/sms-jobs";

/**
 * Module 49 — SMS Notifications.
 *
 * Implements the application-layer `SmsQueue` port over a Module 45
 * `Queue` — the exact counterpart of `SearchIndexQueueAdapter`
 * (`infrastructure/search/search-index-queue-adapter.ts`). Keeps the
 * `Queue`/`JobOptions` vocabulary out of the application layer, so
 * `SmsNotificationChannel` depends on "I can request an SMS send" and not
 * on "there is a job queue with attempts and backoff".
 *
 * Retry policy lives here for the same reason it lives in
 * `SearchIndexQueueAdapter`: it is a property of the *enqueued job*
 * (`JobOptions.attempts`/`.backoff`) in Module 45's model, reusing this
 * platform's established exponential-with-jitter policy so a batch of SMS
 * sends that all failed on the same Twilio outage does not retry in
 * lockstep.
 */
export class SmsQueueAdapter implements SmsQueue {
  constructor(
    private readonly queue: Queue<SmsDispatchJobData>,
    private readonly jobOptions: JobOptions,
  ) {}

  async enqueue(request: SmsDispatchRequest): Promise<void> {
    await this.queue.add(
      `sms.${request.type}`,
      {
        userId: request.userId,
        phone: request.phone,
        type: request.type,
        fallbackMessage: request.fallbackMessage,
        locale: request.locale,
        resourceType: request.resourceType,
        resourceId: request.resourceId,
        metadata: request.metadata,
      },
      { ...this.jobOptions, jobId: smsDispatchJobId(request) },
    );
  }
}
