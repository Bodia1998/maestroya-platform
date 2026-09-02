import { computeBackoffDelayMs } from "@/infrastructure/jobs/backoff";
import {
  PERMANENT_PURGE_ERROR_CATEGORIES,
  type CloudinaryPurgeErrorCategory,
} from "@/infrastructure/storage/cloudinary/cloudinary-purge-error-classifier";

/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
 *
 * Pure retry-policy decisions — no I/O, no Prisma, no Cloudinary SDK —
 * shared by the inline first attempt inside `ExecuteAccountErasureUseCase`
 * and every subsequent attempt `RetryPendingCloudinaryPurgesUseCase`
 * drives. Kept as free functions (not a class) and in `domain/services`
 * rather than `application/use-cases` because — like
 * `gdpr-privacy-rules.ts` and `professional-verification-rules.ts` — this
 * is a pure business rule about *when* a retry may happen, independent of
 * any particular use case's orchestration.
 *
 * Reuses `computeBackoffDelayMs` (Module 45's job-queue backoff helper)
 * rather than inventing a second exponential-backoff formula — same
 * `delay * 2 ** (attemptsMade - 1)`, capped at `MAX_BACKOFF_MS` (1 hour),
 * same jitter semantics. This module's retry state is durable
 * Postgres columns, not a `JobStore` entry (see
 * `ProfessionalVerificationDocument.storagePurgeStatus`'s own doc comment
 * for why a parallel job-queue entry was deliberately not used — the
 * existing `JobStore` can fall back to `InMemoryJobStore` when `REDIS_URL`
 * is unset, which would violate this module's durability requirement) —
 * only the delay *math* is shared, not the storage mechanism.
 */
export interface CloudinaryPurgeRetryConfig {
  /** `GDPR_CLOUDINARY_PURGE_MAX_ATTEMPTS`. */
  maxAttempts: number;
  /** `GDPR_CLOUDINARY_PURGE_BASE_DELAY_SECONDS`, converted to ms by the caller. */
  baseDelayMs: number;
}

export interface PurgeRetryDecision {
  /** `true` once this attempt count/category combination has exhausted
   *  retries — the caller must persist `DocumentStoragePurgeStatus.DEAD_LETTER`. */
  deadLetter: boolean;
  /** The next eligible retry time, or `null` when `deadLetter` is `true`
   *  (nothing left to schedule). */
  nextAttemptAt: Date | null;
}

/**
 * Decides what happens after attempt number `attemptCount` (1-based —
 * the attempt that just failed) fails with `category`.
 *
 * - A permanent category (`AUTHENTICATION`/`INVALID_REQUEST` — see
 *   `PERMANENT_PURGE_ERROR_CATEGORIES`) always dead-letters immediately,
 *   regardless of `attemptCount` — retrying a bad API key or an
 *   unresolvable URL is never useful (module brief rule 5).
 * - Otherwise, dead-letters once `attemptCount >= config.maxAttempts`;
 *   below that, schedules another attempt at `now + backoff(attemptCount)`.
 */
export function decidePurgeRetry(
  attemptCount: number,
  category: CloudinaryPurgeErrorCategory,
  config: CloudinaryPurgeRetryConfig,
  now: Date = new Date(),
): PurgeRetryDecision {
  if (PERMANENT_PURGE_ERROR_CATEGORIES.has(category)) {
    return { deadLetter: true, nextAttemptAt: null };
  }

  if (attemptCount >= config.maxAttempts) {
    return { deadLetter: true, nextAttemptAt: null };
  }

  const delayMs = computeBackoffDelayMs(attemptCount, { type: "exponential", delay: config.baseDelayMs });
  return { deadLetter: false, nextAttemptAt: new Date(now.getTime() + delayMs) };
}
