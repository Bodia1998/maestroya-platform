import type { QueueCounts } from "@/infrastructure/jobs/job-types";

/**
 * Module 49 — SMS Notifications.
 *
 * The shape `/api/health/ready` reports for the SMS pipeline under
 * `checks.smsProvider` — joining `checks.cache`/`checks.queue`/
 * `checks.searchEngine`/`checks.realtime` in that route's established
 * "operational visibility only" category: reported, never allowed to
 * change the response's overall `status` or HTTP code.
 *
 * The reasoning matches `checks.queue`'s own directly: a degraded or
 * misconfigured SMS provider does not mean this instance can't serve HTTP
 * traffic, take a booking, or process a payment — it means one
 * best-effort notification channel is temporarily or permanently unable
 * to deliver, exactly the same failure category `EMAIL`/`WEB_PUSH`
 * already sit in (neither of which has its own readiness check either).
 * A 503 here would trigger a pointless failover that cannot fix a Twilio
 * outage or a missing credential.
 */
export type SmsProviderHealthStatus = "healthy" | "degraded" | "unavailable";

export interface SmsProviderHealthReport {
  status: SmsProviderHealthStatus;
  /** `"mock"` | `"twilio"` — the configured `SMS_PROVIDER`. */
  provider: string;
  /** `true` once the selected provider has everything it needs to send
   *  (always `true` for `mock`; for `twilio`, whether all three
   *  credentials are present). */
  configured: boolean;
  /** Counts for the `sms-dispatch` queue and its dead-letter queue, once
   *  the pipeline has been used at least once in this process. */
  queue: Record<string, QueueCounts>;
}

/** Reported when `SMS_PROVIDER=mock` (the default) and no SMS has been
 *  enqueued yet in this process — mirrors `DISABLED_SEARCH_ENGINE_HEALTH`'s
 *  "disabled is a healthy, deliberate state" precedent. `mock` is always
 *  fully functional (it never fails to "send"), so this reports
 *  `"healthy"`, not `"disabled"` — unlike search indexing, there is no
 *  operator switch that turns SMS off; there is only "no real provider
 *  configured yet", which is not a failure state for a platform default. */
export const DISABLED_SMS_PROVIDER_HEALTH: SmsProviderHealthReport = {
  status: "healthy",
  provider: "mock",
  configured: true,
  queue: {},
};

export interface SmsHealthInputs {
  provider: string;
  configured: boolean;
  queues: readonly { readonly name: string; getCounts(): Promise<QueueCounts> }[];
}

/**
 * Collects the report. Never throws — a failing health *check* must not
 * itself become an incident, mirroring `collectQueueHealth`/
 * `collectSearchEngineHealth` exactly.
 */
export async function collectSmsProviderHealth(inputs: SmsHealthInputs): Promise<SmsProviderHealthReport> {
  const queue: Record<string, QueueCounts> = {};
  let queueError = false;

  try {
    for (const source of inputs.queues) {
      queue[source.name] = await source.getCounts();
    }
  } catch {
    queueError = true;
  }

  const status: SmsProviderHealthStatus = !inputs.configured
    ? "unavailable"
    : queueError
      ? "degraded"
      : "healthy";

  return {
    status,
    provider: inputs.provider,
    configured: inputs.configured,
    queue,
  };
}
