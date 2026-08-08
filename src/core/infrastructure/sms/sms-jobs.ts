import { randomUUID } from "node:crypto";

import type { SmsDispatchRequest } from "@/application/ports/sms-queue";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 49 — SMS Notifications.
 *
 * The job vocabulary of the SMS dispatch pipeline — this module's
 * counterpart to `infrastructure/search/search-index-jobs.ts`. Adds no
 * retry/backoff/dead-letter machinery of its own; Module 45's `Worker`
 * already implements all three, and `compose.ts` simply configures them.
 */

export const SMS_DISPATCH_QUEUE_NAME = "sms-dispatch";
export const SMS_DISPATCH_DEAD_LETTER_QUEUE_NAME = "sms-dispatch-dead-letter";

/** Job payload. Plain and JSON-safe, like every `StoredJob` data (Module 45). */
export interface SmsDispatchJobData {
  userId: string;
  phone: string;
  type: string;
  fallbackMessage: string;
  locale?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The enqueue-time job id (Module 45's first idempotency line of
 * defence). Unlike `searchIndexJobId`, `SmsNotificationChannel` has no
 * domain-event id available to key on — `NotificationChannelPayload`
 * carries no `eventId` (see that port's own doc comment: it is a
 * channel-agnostic delivery payload, deliberately decoupled from the
 * event that produced it). Keying on `resourceId` + `type` + `userId`
 * when a `resourceId` is present still catches the most common
 * duplicate-enqueue case (the same notification retried at the
 * `NotificationDispatcher` layer within the same request); a random
 * suffix is used when no `resourceId` is available, which forgoes
 * enqueue-time de-duplication for that one send rather than risk
 * collapsing two unrelated notifications (e.g. two different chat
 * messages) that happen to share a type and no resource id.
 */
export function smsDispatchJobId(request: SmsDispatchRequest): string {
  const suffix = request.resourceId ?? randomUUID();
  return `sms:${request.type}:${request.userId}:${suffix}`;
}

/**
 * The execution-time idempotency key (Module 45's second defence — covers
 * a job that ran successfully but whose completion was lost). Keyed on
 * the job's own id: `Worker` retries reuse the same `StoredJob.id` across
 * attempts, so this is stable for the job's whole lifecycle and, unlike
 * `searchIndexJobIdempotencyKey`, needs no business key of its own — the
 * job id already *is* "this specific enqueued send", which is exactly
 * what execution-time de-duplication needs to protect.
 */
export function smsDispatchJobIdempotencyKey(job: ActiveJob<SmsDispatchJobData>): string {
  return `sms:${job.id}`;
}
