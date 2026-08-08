import "server-only";

import type { SmsSender } from "@/application/interfaces/sms-sender";
import type { SmsQueue } from "@/application/ports/sms-queue";
import { env } from "@/infrastructure/config/env";
import {
  createManagedQueue,
  getBackgroundJobRuntime,
  getJobObserver,
  jobDefaults,
} from "@/infrastructure/jobs/compose";
import { createJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { createJobStore } from "@/infrastructure/jobs/job-store-factory";
import type { QueueCounts } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";
import { createSmsDispatchJobProcessor } from "@/infrastructure/sms/sms-dispatch-job-processor";
import {
  SMS_DISPATCH_DEAD_LETTER_QUEUE_NAME,
  SMS_DISPATCH_QUEUE_NAME,
  smsDispatchJobIdempotencyKey,
  type SmsDispatchJobData,
} from "@/infrastructure/sms/sms-jobs";
import { createSmsSender } from "@/infrastructure/sms/sms-sender-factory";
import { SmsQueueAdapter } from "@/infrastructure/sms/sms-queue-adapter";
import type { SmsProviderHealthReport } from "@/infrastructure/sms/sms-health";
import { collectSmsProviderHealth, DISABLED_SMS_PROVIDER_HEALTH } from "@/infrastructure/sms/sms-health";

/**
 * Module 49 — SMS Notifications.
 *
 * Composition root for the SMS pipeline — the same manual, no-DI-container
 * convention as every other `compose.ts` in this codebase
 * (`infrastructure/search/compose.ts`, `infrastructure/jobs/compose.ts`),
 * and structurally the closest analogue of the four: a provider
 * (`SmsSender`, selected by `createSmsSender()`), a queue + worker built
 * on the shared Module 45 job runtime, and a health report consumed by
 * `/api/health/ready`.
 *
 * ## Why the queue and worker are lazy
 * Exactly `infrastructure/search/compose.ts`'s own reasoning, reproduced
 * here for the same two causes: Next.js imports modules during `next
 * build` for analysis, where constructing a worker (which polls) would be
 * wrong; and `notification-dispatcher.compose.ts` (which wires
 * `SmsNotificationChannel` into the shared `NotificationDispatcher`) must
 * be importable — and every non-SMS channel must keep working — even in a
 * process that never sends a single SMS. `getSmsQueue()` therefore builds
 * the queue/worker on first use, not at import time.
 */

let sender: SmsSender | null = null;
let smsQueue: Queue<SmsDispatchJobData> | null = null;
let deadLetterQueue: Queue<DeadLetterJobData> | null = null;
let queueAdapter: SmsQueue | null = null;
let worker: Worker<SmsDispatchJobData> | null = null;

export function getSmsSender(): SmsSender {
  if (!sender) sender = createSmsSender();
  return sender;
}

/**
 * The queue `SmsNotificationChannel` enqueues into, plus — on first call
 * — the worker that drains it. Configured with, and adds nothing to,
 * Module 45's machinery: `attempts`/`backoff` from `jobDefaults` (the
 * same exponential-with-jitter policy `SearchIndexQueueAdapter` uses),
 * `deadLetterQueue` for exhausted jobs, and execution-time idempotency
 * keyed by `smsDispatchJobIdempotencyKey`.
 */
export function getSmsQueue(): SmsQueue {
  if (!queueAdapter) {
    smsQueue = createManagedQueue<SmsDispatchJobData>(SMS_DISPATCH_QUEUE_NAME);
    deadLetterQueue = createManagedQueue<DeadLetterJobData>(SMS_DISPATCH_DEAD_LETTER_QUEUE_NAME);

    worker = new Worker<SmsDispatchJobData>(
      SMS_DISPATCH_QUEUE_NAME,
      createSmsDispatchJobProcessor(getSmsSender()),
      {
        store: createJobStore(),
        concurrency: jobDefaults.concurrency,
        deadLetterQueue,
        observer: getJobObserver(),
        idempotency: {
          store: createJobIdempotencyStore(),
          keyFor: (job) => smsDispatchJobIdempotencyKey(job as never),
        },
      },
    );

    getBackgroundJobRuntime().registerWorker(worker);

    queueAdapter = new SmsQueueAdapter(smsQueue, {
      attempts: jobDefaults.maxAttempts,
      backoff: { type: "exponential", delay: 1000, jitter: 0.2 },
    });
  }
  return queueAdapter;
}

/**
 * The deferred `SmsQueue` handed to `SmsNotificationChannel` — a one-line
 * indirection that keeps `getSmsQueue()`'s laziness honest, the same
 * pattern `search/compose.ts`'s `registerSearchIndexSubscribers()` uses
 * for `SearchIndexQueue`: building the real queue only happens the first
 * time an SMS actually needs to be enqueued, not merely because
 * `notification-dispatcher.compose.ts` was imported.
 */
export const deferredSmsQueue: SmsQueue = {
  enqueue: (request) => getSmsQueue().enqueue(request),
};

export async function getSmsProviderHealth(): Promise<SmsProviderHealthReport> {
  if (!smsQueue && !deadLetterQueue) {
    // No SMS has been enqueued in this process yet — report the
    // configured provider without implying a queue/worker exists.
    if (env.SMS_PROVIDER === "mock") return DISABLED_SMS_PROVIDER_HEALTH;
  }

  const queues: { name: string; getCounts(): Promise<QueueCounts> }[] = [];
  if (smsQueue) queues.push(smsQueue);
  if (deadLetterQueue) queues.push(deadLetterQueue);

  return collectSmsProviderHealth({
    provider: env.SMS_PROVIDER,
    configured: env.SMS_PROVIDER === "mock" || Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
    queues,
  });
}

/** Exposed for tests only — drops every singleton so the next call rebuilds. */
export const __testing = {
  reset(): void {
    sender = null;
    smsQueue = null;
    deadLetterQueue = null;
    queueAdapter = null;
    worker = null;
  },
  get worker(): Worker<SmsDispatchJobData> | null {
    return worker;
  },
};
