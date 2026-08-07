import type { BackoffOptions } from "@/infrastructure/jobs/job-types";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Retry-delay calculation, matching BullMQ's built-in `fixed` and
 * `exponential` strategies exactly: `exponential` waits
 * `delay * 2 ** (attemptsMade - 1)`, so a `delay: 1000` job retries after
 * 1s, 2s, 4s, 8s… and `fixed` waits `delay` every time.
 *
 * Capped at `MAX_BACKOFF_MS` so a job configured with many attempts
 * cannot schedule itself days into the future through sheer doubling —
 * a failure mode BullMQ leaves to the caller, but which is never useful
 * for this platform's jobs (an audit-log write that has failed for an
 * hour needs an operator, not a longer wait).
 *
 * `jitter` (see `BackoffOptions`) is applied as a *subtractive* random
 * fraction, so the computed delay is always in `[delay * (1 - jitter),
 * delay]` — never longer than the caller asked for.
 */
export const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 hour

export function computeBackoffDelayMs(
  attemptsMade: number,
  backoff: BackoffOptions,
  random: () => number = Math.random,
): number {
  if (attemptsMade < 1) {
    throw new RangeError(`attemptsMade must be >= 1 when computing a backoff delay, received ${attemptsMade}`);
  }

  const base =
    backoff.type === "exponential" ? backoff.delay * Math.pow(2, attemptsMade - 1) : backoff.delay;

  const capped = Math.min(base, MAX_BACKOFF_MS);

  const jitter = backoff.jitter ?? 0;
  if (jitter <= 0) return capped;

  const spread = capped * Math.min(jitter, 1);
  return Math.max(0, Math.round(capped - random() * spread));
}
