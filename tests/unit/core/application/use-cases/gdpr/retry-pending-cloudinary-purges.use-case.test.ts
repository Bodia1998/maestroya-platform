import { describe, expect, it } from "vitest";

import {
  RetryPendingCloudinaryPurgesUseCase,
  type CloudinaryPurgeRetryRepository,
} from "@/application/use-cases/gdpr/retry-pending-cloudinary-purges.use-case";
import type { VerificationDocumentRecord } from "@/domain/repositories/professional-verification-repository";
import type { VerificationDocumentStorageDeleter } from "@/application/interfaces/verification-document-storage-deleter";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import { StorageDeletionFailedError } from "@/infrastructure/storage/cloudinary/verification-document-deletion-service";

const RETRY_CONFIG = { maxAttempts: 3, baseDelayMs: 1000 };

function makeDocument(overrides: Partial<VerificationDocumentRecord> = {}): VerificationDocumentRecord {
  return {
    id: overrides.id ?? `doc-${Math.random().toString(36).slice(2)}`,
    verificationId: "verification-1",
    type: "NATIONAL_ID",
    status: "APPROVED",
    fileUrl: "https://res.cloudinary.com/test/image/private/s--sig--/v1/x.jpg",
    originalFilename: "id.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 1024,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: new Date(),
    storagePurgedAt: null,
    storagePurgeStatus: "PENDING",
    storagePurgeAttemptCount: 0,
    storagePurgeNextAttemptAt: null,
    storagePurgeLastError: null,
    storagePurgeLastAttemptedAt: null,
    ...overrides,
  };
}

/**
 * In-memory fake implementing the use case's own narrow
 * `CloudinaryPurgeRetryRepository` slice — atomic in the trivial
 * single-threaded-JS sense (no two `claimPendingStoragePurgeBatch` calls
 * interleave mid-splice), which is enough to prove the use case's own
 * per-document logic; genuine cross-connection concurrency safety is
 * proven separately against real PostgreSQL
 * (`tests/integration-db/gdpr/gdpr-cloudinary-purge-retry.test.ts`).
 */
class FakeRepo implements CloudinaryPurgeRetryRepository {
  docs: VerificationDocumentRecord[];
  claimCalls: number[] = [];

  constructor(docs: VerificationDocumentRecord[]) {
    this.docs = docs;
  }

  async claimPendingStoragePurgeBatch(now: Date, batchSize: number) {
    this.claimCalls.push(batchSize);
    const due = this.docs.filter(
      (d) =>
        d.deletedAt &&
        !d.storagePurgedAt &&
        d.storagePurgeStatus === "PENDING" &&
        (d.storagePurgeNextAttemptAt === null || d.storagePurgeNextAttemptAt <= now),
    );
    return due.slice(0, batchSize);
  }

  async markDocumentStoragePurged(documentId: string) {
    const doc = this.docs.find((d) => d.id === documentId);
    if (!doc) return;
    doc.storagePurgedAt = new Date();
    doc.storagePurgeStatus = "PENDING";
    doc.storagePurgeAttemptCount = 0;
    doc.storagePurgeNextAttemptAt = null;
  }

  async recordDocumentStoragePurgeFailure(
    documentId: string,
    data: { attemptCount: number; nextAttemptAt: Date | null; deadLetter: boolean; errorMessage: string },
  ) {
    const doc = this.docs.find((d) => d.id === documentId);
    if (!doc) return;
    doc.storagePurgeStatus = data.deadLetter ? "DEAD_LETTER" : "PENDING";
    doc.storagePurgeAttemptCount = data.attemptCount;
    doc.storagePurgeNextAttemptAt = data.nextAttemptAt;
    doc.storagePurgeLastError = data.errorMessage;
  }
}

class AlwaysSucceedsDeleter implements VerificationDocumentStorageDeleter {
  calls: string[] = [];
  async deleteByUrl(fileUrl: string): Promise<void> {
    this.calls.push(fileUrl);
  }
}

class AlwaysFailsDeleter implements VerificationDocumentStorageDeleter {
  constructor(private readonly cause: unknown = { http_code: 500, message: "server error" }) {}
  async deleteByUrl(fileUrl: string): Promise<void> {
    throw new StorageDeletionFailedError(fileUrl, this.cause);
  }
}

class NeverAcquiresLock implements DistributedLock {
  async withLock<T>(): Promise<T | null> {
    return null;
  }
}

describe("Module 94 — RetryPendingCloudinaryPurgesUseCase", () => {
  it("provider success: claims and purges a due document, clearing retry state", async () => {
    const repo = new FakeRepo([makeDocument()]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, new AlwaysSucceedsDeleter(), RETRY_CONFIG);
    const result = await useCase.execute(10);

    expect(result).toEqual({ outcome: "completed", claimed: 1, succeeded: 1, retried: 0, deadLettered: 0 });
    expect(repo.docs[0]!.storagePurgedAt).not.toBeNull();
  });

  it("provider not-found: the adapter resolving normally (its own already-gone convention) counts as success", async () => {
    // CloudinaryVerificationDocumentDeletionService itself never throws
    // for Cloudinary's "not found" destroy result — it resolves, exactly
    // like AlwaysSucceedsDeleter simulates here. Nothing use-case-level
    // needs to special-case "not found" — see that adapter's own doc
    // comment.
    const repo = new FakeRepo([makeDocument()]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, new AlwaysSucceedsDeleter(), RETRY_CONFIG);
    const result = await useCase.execute(10);
    expect(result.succeeded).toBe(1);
  });

  it("provider transient failure: increments attempt and schedules a future retry, stays PENDING", async () => {
    const repo = new FakeRepo([makeDocument()]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, new AlwaysFailsDeleter(), RETRY_CONFIG);
    const result = await useCase.execute(10);

    expect(result.retried).toBe(1);
    expect(repo.docs[0]!.storagePurgeStatus).toBe("PENDING");
    expect(repo.docs[0]!.storagePurgeAttemptCount).toBe(1);
    expect(repo.docs[0]!.storagePurgeNextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("provider permanent failure (AUTHENTICATION): dead-letters on the very first attempt", async () => {
    const repo = new FakeRepo([makeDocument()]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(
      repo,
      new AlwaysFailsDeleter({ http_code: 401, message: "unauthorized" }),
      RETRY_CONFIG,
    );
    const result = await useCase.execute(10);

    expect(result.deadLettered).toBe(1);
    expect(repo.docs[0]!.storagePurgeStatus).toBe("DEAD_LETTER");
  });

  it("maximum attempts: dead-letters once attemptCount reaches maxAttempts", async () => {
    const repo = new FakeRepo([makeDocument({ storagePurgeAttemptCount: RETRY_CONFIG.maxAttempts - 1 })]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, new AlwaysFailsDeleter(), RETRY_CONFIG);
    const result = await useCase.execute(10);

    expect(result.deadLettered).toBe(1);
    expect(repo.docs[0]!.storagePurgeStatus).toBe("DEAD_LETTER");
    expect(repo.docs[0]!.storagePurgeAttemptCount).toBe(RETRY_CONFIG.maxAttempts);
  });

  it("batch processing: never claims more than the requested batch size", async () => {
    const repo = new FakeRepo([makeDocument(), makeDocument(), makeDocument()]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, new AlwaysSucceedsDeleter(), RETRY_CONFIG);
    const result = await useCase.execute(2);

    expect(result.claimed).toBe(2);
    expect(repo.claimCalls).toEqual([2]);
  });

  it("processes a mixed batch independently — one success does not affect another document's failure", async () => {
    const good = makeDocument({ id: "good", fileUrl: "https://res.cloudinary.com/test/image/private/s--sig--/v1/good.jpg" });
    const bad = makeDocument({ id: "bad", fileUrl: "https://res.cloudinary.com/test/image/private/s--sig--/v1/bad.jpg" });
    const repo = new FakeRepo([good, bad]);
    const deleter: VerificationDocumentStorageDeleter = {
      async deleteByUrl(fileUrl: string) {
        if (fileUrl === good.fileUrl) return;
        throw new StorageDeletionFailedError(fileUrl, { http_code: 500 });
      },
    };
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, deleter, RETRY_CONFIG);
    const result = await useCase.execute(10);

    expect(result.succeeded).toBe(1);
    expect(result.retried).toBe(1);
    expect(repo.docs.find((d) => d.id === "good")!.storagePurgedAt).not.toBeNull();
    expect(repo.docs.find((d) => d.id === "bad")!.storagePurgeStatus).toBe("PENDING");
  });

  it("skips entirely when the distributed lock is already held (outcome: skipped_locked)", async () => {
    const repo = new FakeRepo([makeDocument()]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(
      repo,
      new AlwaysSucceedsDeleter(),
      RETRY_CONFIG,
      new NeverAcquiresLock(),
    );
    const result = await useCase.execute(10);

    expect(result).toEqual({ outcome: "skipped_locked", claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 });
    expect(repo.claimCalls).toHaveLength(0);
  });

  it("with no lock provided, still processes correctly (lock is optional, not required for correctness)", async () => {
    const repo = new FakeRepo([makeDocument()]);
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, new AlwaysSucceedsDeleter(), RETRY_CONFIG, null);
    const result = await useCase.execute(10);
    expect(result.outcome).toBe("completed");
  });
});
