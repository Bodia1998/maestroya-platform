import type { VerificationDocumentStorageDeleter } from "@/application/interfaces/verification-document-storage-deleter";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";

/**
 * The narrow slice of `ProfessionalVerificationRepository` this use case
 * actually depends on — same "depend on the smallest interface that
 * satisfies the caller" convention `GdprErasureRepos` itself documents.
 * `PrismaProfessionalVerificationRepository` satisfies this structurally
 * (no adapter change needed); a unit test fake only has to implement
 * these three methods instead of the repository's full ~20-method
 * surface.
 */
export type CloudinaryPurgeRetryRepository = Pick<
  ProfessionalVerificationRepository,
  "claimPendingStoragePurgeBatch" | "markDocumentStoragePurged" | "recordDocumentStoragePurgeFailure"
>;
import {
  decidePurgeRetry,
  type CloudinaryPurgeRetryConfig,
} from "@/domain/services/gdpr-cloudinary-purge-policy";
import {
  classifyStorageDeletionError,
  describeCloudinaryPurgeError,
} from "@/infrastructure/storage/cloudinary/cloudinary-purge-error-classifier";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
 *
 * The scheduled counterpart to the inline purge attempt inside
 * `ExecuteAccountErasureUseCase` (module brief rule 6: "Create a
 * dedicated application use case"). Architecture, matching the brief
 * exactly:
 *
 * ```
 * Cron (/api/cron/gdpr-cloudinary-purge)
 *         v
 * RetryPendingCloudinaryPurgesUseCase   (this file — retry policy, batching, locking)
 *         v
 * ProfessionalVerificationRepository    (claimPendingStoragePurgeBatch / recordDocumentStoragePurgeFailure / markDocumentStoragePurged)
 *         v
 * VerificationDocumentStorageDeleter    (application port)
 *         v
 * CloudinaryVerificationDocumentDeletionService (infrastructure adapter, owns the Cloudinary SDK)
 * ```
 *
 * ## State machine (per document)
 * `deletedAt` set, `storagePurgedAt` null, `storagePurgeStatus = PENDING`
 * → claimed by this use case → Cloudinary `destroy`:
 *   - success, or "not found" (already gone — the adapter itself treats
 *     this as success, see its own doc comment) → `storagePurgedAt` set,
 *     retry state cleared. Terminal, success.
 *   - failure, permanent category (`AUTHENTICATION`/`INVALID_REQUEST`) →
 *     `storagePurgeStatus = DEAD_LETTER` immediately, regardless of
 *     attempt count. Terminal, requires manual review.
 *   - failure, transient/rate-limited/unknown, attempts remaining →
 *     `storagePurgeAttemptCount` incremented, `storagePurgeNextAttemptAt`
 *     set via `decidePurgeRetry`'s bounded exponential backoff. Stays
 *     `PENDING`, re-claimable once due.
 *   - failure, transient/rate-limited/unknown, attempts exhausted →
 *     `storagePurgeStatus = DEAD_LETTER`. Terminal, requires manual
 *     review — never silently discarded (module brief rule 5).
 *
 * ## Concurrency
 * `claimPendingStoragePurgeBatch` is itself concurrency-safe at the
 * database level (`SELECT ... FOR UPDATE SKIP LOCKED`, see its own doc
 * comment) — two overlapping invocations of this use case can never claim
 * the same row. The `DistributedLock` wrap here is a *coarser*,
 * purely-cost-saving layer on top: without it, two overlapping cron
 * invocations would both run a full claim query and a (smaller,
 * non-overlapping) batch of Cloudinary calls — safe, but wasted work and
 * duplicated Cloudinary API traffic. With it, the loser skips entirely
 * and returns `outcome: "skipped_locked"` — same "skip, don't block or
 * retry" contract `RunScheduledReconciliationSweepUseCase` already
 * established for this exact scenario (Module 92). `lock` is optional —
 * a caller (e.g. a unit test) that omits it just accepts the
 * fully-redundant-work cost, never a correctness risk, since the DB claim
 * still holds.
 *
 * ## Batch size
 * Bounded by `batchSize` (module brief rule 7 — `GDPR_CLOUDINARY_PURGE_
 * RETRY_BATCH_SIZE`). Never processes the whole outstanding queue in one
 * invocation; a queue larger than one batch is drained across multiple
 * scheduled invocations.
 */
export interface RetryPendingCloudinaryPurgesResult {
  outcome: "completed" | "skipped_locked";
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
}

const LOCK_KEY = "gdpr-cloudinary-purge-retry";
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes — comfortably longer than one batch's expected duration.

export class RetryPendingCloudinaryPurgesUseCase {
  constructor(
    private readonly repo: CloudinaryPurgeRetryRepository,
    private readonly documentStorage: VerificationDocumentStorageDeleter,
    private readonly retryConfig: CloudinaryPurgeRetryConfig,
    private readonly lock: DistributedLock | null = null,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(batchSize: number): Promise<RetryPendingCloudinaryPurgesResult> {
    if (!this.lock) return this.runBatch(batchSize);

    const result = await this.lock.withLock(LOCK_KEY, LOCK_TTL_MS, () => this.runBatch(batchSize));
    if (result === null) {
      return { outcome: "skipped_locked", claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 };
    }
    return result;
  }

  private async runBatch(batchSize: number): Promise<RetryPendingCloudinaryPurgesResult> {
    const now = this.now();
    const batch = await this.repo.claimPendingStoragePurgeBatch(now, batchSize);

    let succeeded = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const document of batch) {
      const attemptCount = document.storagePurgeAttemptCount + 1;
      try {
        await this.documentStorage.deleteByUrl(document.fileUrl);
        await this.repo.markDocumentStoragePurged(document.id);
        succeeded += 1;
        logger.info("gdpr_cloudinary_purge_success", {
          operation: "gdpr_cloudinary_purge_retry",
          provider: "cloudinary",
          documentId: document.id,
          attempt: attemptCount,
        });
      } catch (error) {
        const category = classifyStorageDeletionError(error);
        const decision = decidePurgeRetry(attemptCount, category, this.retryConfig, now);
        const message = describeCloudinaryPurgeError(category, error);

        await this.repo.recordDocumentStoragePurgeFailure(document.id, {
          attemptCount,
          nextAttemptAt: decision.nextAttemptAt,
          deadLetter: decision.deadLetter,
          errorMessage: message,
        });

        if (decision.deadLetter) {
          deadLettered += 1;
          logger.error("gdpr_cloudinary_purge_dead_letter", {
            operation: "gdpr_cloudinary_purge_retry",
            provider: "cloudinary",
            documentId: document.id,
            attempt: attemptCount,
            errorCategory: category,
          });
          this.failureReporter.report(error instanceof Error ? error : new Error(String(error)), {
            documentId: document.id,
            attempt: attemptCount,
            errorCategory: category,
            terminal: true,
          });
        } else {
          retried += 1;
          logger.warn("gdpr_cloudinary_purge_retry_scheduled", {
            operation: "gdpr_cloudinary_purge_retry",
            provider: "cloudinary",
            documentId: document.id,
            attempt: attemptCount,
            errorCategory: category,
            nextRetryAt: decision.nextAttemptAt?.toISOString() ?? null,
          });
        }
      }
    }

    return { outcome: "completed", claimed: batch.length, succeeded, retried, deadLettered };
  }
}
