import type { SmsSender } from "@/application/interfaces/sms-sender";
import type { JobProcessor } from "@/infrastructure/jobs/worker";
import { buildSmsBody } from "@/infrastructure/sms/sms-template-mapping";
import type { SmsDispatchJobData } from "@/infrastructure/sms/sms-jobs";

/**
 * Module 49 — SMS Notifications.
 *
 * The `JobProcessor` the SMS dispatch `Worker` runs: renders the body
 * (`buildSmsBody`) and calls `SmsSender.send()`. All the actual
 * behaviour — provider selection, HTTP call, template rendering — lives
 * elsewhere in the application/infrastructure layers, where it is
 * testable without a worker; this file is the adapter between the queue
 * and those pieces, the exact counterpart of
 * `createSearchIndexJobProcessor` (`infrastructure/search/search-index-
 * job-processor.ts`).
 *
 * ## Errors are thrown, never handled
 * `SmsSender.send()`'s rejection is allowed to escape unchanged. That is
 * the contract Module 45's `Worker` is built around: a throw means "this
 * attempt failed", and the worker decides — retry with exponential
 * backoff while attempts remain, otherwise report and move the job to
 * the dead-letter queue with its full payload (recipient phone number
 * included — see docs/MODULE_49_SMS_NOTIFICATIONS.md, "Observability &
 * PII" for why that is an accepted, documented trade-off shared with
 * every other dead-lettered job in this codebase, none of which redact
 * their payload either). Catching here would silently convert a failed
 * SMS into a successful job with no trace that the recipient never
 * received it.
 */
export function createSmsDispatchJobProcessor(sender: SmsSender): JobProcessor<SmsDispatchJobData> {
  return async (job) => {
    const body = buildSmsBody(job.data);
    await sender.send({ to: job.data.phone, body });
  };
}
