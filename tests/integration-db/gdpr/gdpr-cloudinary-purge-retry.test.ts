/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
 *
 * Real-PostgreSQL proof of the durable retry state machine implemented on
 * `professional_verification_documents` — see schema.prisma's own doc
 * comment on `ProfessionalVerificationDocument.storagePurgeStatus` and
 * `PrismaProfessionalVerificationRepository.claimPendingStoragePurgeBatch`'s
 * own doc comment for the full design.
 *
 * Every scenario in the module brief's "Real PostgreSQL integration
 * tests" section is covered here: initial failure, restart safety,
 * successful retry, not-found, transient failure, maximum attempts,
 * batch limit, concurrency, user-row independence, and idempotency.
 *
 * Documents are seeded already soft-deleted (`deletedAt` set) — the exact
 * post-erasure state `ExecuteAccountErasureUseCase` leaves behind, per
 * Module 88 — rather than re-running the full erasure use case here
 * (that flow is already covered by `tests/integration/gdpr/
 * gdpr-erasure-execution.test.ts`, against fakes). This file's own scope
 * is the Module 94 retry machinery: the repository's claim/record-failure
 * methods and `RetryPendingCloudinaryPurgesUseCase`, against a real
 * database.
 *
 * KNOWN LIMITATION (documented in MODULE_94_IMPLEMENTATION_REPORT.md):
 * this file could not be executed end-to-end in the sandbox this module
 * was developed in — the same pre-existing `binaries.prisma.sh` egress
 * block Module 91's own report documents on `npm run test:integration:db`
 * (confirmed independently in this exact environment: `npx prisma
 * validate`/`generate` both fail with `403 Forbidden` fetching the
 * schema-engine/query-engine binaries). It is written to run against the
 * repository's own CI, which already provisions and migrates a real
 * `postgres:16-alpine` service — see Module 91's report §9 for the
 * equivalent independent-verification precedent this module follows in
 * its own report instead.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";
import { RetryPendingCloudinaryPurgesUseCase } from "@/application/use-cases/gdpr/retry-pending-cloudinary-purges.use-case";
import { decidePurgeRetry } from "@/domain/services/gdpr-cloudinary-purge-policy";
import type { VerificationDocumentStorageDeleter } from "@/application/interfaces/verification-document-storage-deleter";
import { StorageDeletionFailedError } from "@/infrastructure/storage/cloudinary/verification-document-deletion-service";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createProfessionalProfile, createUser } from "../../test-utils/db/seed-helpers";

const RETRY_CONFIG = { maxAttempts: 3, baseDelayMs: 1000 };

/** A `VerificationDocumentStorageDeleter` scripted per-call by the test. */
class ScriptedDeleter implements VerificationDocumentStorageDeleter {
  calls: string[] = [];
  private readonly script: Array<() => Promise<void>>;
  private index = 0;

  constructor(script: Array<() => Promise<void>>) {
    this.script = script;
  }

  async deleteByUrl(fileUrl: string): Promise<void> {
    this.calls.push(fileUrl);
    const step = this.script[Math.min(this.index, this.script.length - 1)]!;
    this.index += 1;
    await step();
  }

  static alwaysSucceeds(): ScriptedDeleter {
    return new ScriptedDeleter([async () => {}]);
  }

  static alwaysFailsTransient(): ScriptedDeleter {
    return new ScriptedDeleter([
      async () => {
        throw new StorageDeletionFailedError("https://example.invalid/x.pdf", { http_code: 500, message: "server error" });
      },
    ]);
  }
}

async function seedSoftDeletedDocument(professionalProfileId: string): Promise<string> {
  const verification = await prisma.professionalVerification.create({
    data: { professionalProfileId, status: "REJECTED" },
  });
  const document = await prisma.professionalVerificationDocument.create({
    data: {
      verificationId: verification.id,
      type: "NATIONAL_ID",
      fileUrl: `https://res.cloudinary.com/test/image/private/s--sig--/v1/maestroya/verifications/${verification.id}/${randomUUID()}.jpg`,
      originalFilename: "id.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 1024,
      deletedAt: new Date(),
    },
  });
  return document.id;
}

/**
 * Reads the five Module 94 purge-retry columns via raw SQL rather than
 * `prisma.professionalVerificationDocument.findUniqueOrThrow` — the same
 * reason `PrismaProfessionalVerificationRepository` itself uses raw SQL
 * for these columns (see `PurgeRetryRow`'s own doc comment): the
 * generated Prisma Client in the sandbox this test was developed in
 * predates this migration and cannot be regenerated there. Raw SQL is
 * valid against either an old or a freshly-regenerated client, so this
 * keeps the test itself typecheck-clean right now while remaining
 * correct once `prisma generate` is re-run with registry access.
 */
async function fetchPurgeRetryRow(documentId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      storagePurgedAt: Date | null;
      storagePurgeStatus: "PENDING" | "DEAD_LETTER";
      storagePurgeAttemptCount: number;
      storagePurgeNextAttemptAt: Date | null;
    }>
  >`
    SELECT "storagePurgedAt", "storagePurgeStatus", "storagePurgeAttemptCount", "storagePurgeNextAttemptAt"
    FROM "professional_verification_documents"
    WHERE "id" = ${documentId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new Error(`document ${documentId} not found`);
  return row;
}

/** Forces a row eligible for immediate re-claim, bypassing whatever backoff was computed. */
async function forceEligibleNow(documentId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "professional_verification_documents"
    SET "storagePurgeNextAttemptAt" = ${new Date(Date.now() - 1000)}
    WHERE "id" = ${documentId}::uuid
  `;
}

async function seedUserAndProfile() {
  const user = await createUser(prisma, {});
  const profile = await createProfessionalProfile(prisma, user.id, {});
  return { user, profile };
}

describe("Module 94 — GDPR Cloudinary purge retry (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  it("initial failure: recordDocumentStoragePurgeFailure persists a durable PENDING retry record", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const documentId = await seedSoftDeletedDocument(profile.id);

    const decision = decidePurgeRetry(1, "TRANSIENT", RETRY_CONFIG);
    await repo.recordDocumentStoragePurgeFailure(documentId, {
      attemptCount: 1,
      nextAttemptAt: decision.nextAttemptAt,
      deadLetter: decision.deadLetter,
      errorMessage: "TRANSIENT: simulated",
    });

    const pending = await repo.listDocumentsPendingStoragePurge(profile.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.storagePurgeStatus).toBe("PENDING");
    expect(pending[0]?.storagePurgeAttemptCount).toBe(1);
    expect(pending[0]?.storagePurgeNextAttemptAt).not.toBeNull();
    expect(pending[0]?.storagePurgeLastError).toContain("TRANSIENT");
  });

  it("restart safety: a retry record created by one repository instance is claimable by a brand-new one", async () => {
    const writer = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const documentId = await seedSoftDeletedDocument(profile.id);
    await writer.recordDocumentStoragePurgeFailure(documentId, {
      attemptCount: 1,
      nextAttemptAt: new Date(Date.now() - 1000), // already due
      deadLetter: false,
      errorMessage: "TRANSIENT: simulated",
    });

    // A fresh repository instance/process — nothing shared with `writer`
    // except the database itself.
    const afterRestart = new PrismaProfessionalVerificationRepository();
    const claimed = await afterRestart.claimPendingStoragePurgeBatch(new Date(), 10);
    expect(claimed.map((d) => d.id)).toContain(documentId);
  });

  it("successful retry: pending -> claim -> Cloudinary success -> storagePurgedAt set, retry state cleared", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const documentId = await seedSoftDeletedDocument(profile.id);
    await repo.recordDocumentStoragePurgeFailure(documentId, {
      attemptCount: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
      deadLetter: false,
      errorMessage: "TRANSIENT: simulated",
    });

    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, ScriptedDeleter.alwaysSucceeds(), RETRY_CONFIG, null);
    const result = await useCase.execute(10);

    expect(result.claimed).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const row = await fetchPurgeRetryRow(documentId);
    expect(row.storagePurgedAt).not.toBeNull();
    expect(row.storagePurgeStatus).toBe("PENDING");
    expect(row.storagePurgeAttemptCount).toBe(0);
    expect(row.storagePurgeNextAttemptAt).toBeNull();

    // Idempotency: running the worker again finds nothing left to claim.
    const second = await useCase.execute(10);
    expect(second.claimed).toBe(0);
  });

  it("not found: the storage deleter resolving (Cloudinary's own already-gone-is-success convention) completes the purge", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const documentId = await seedSoftDeletedDocument(profile.id);
    await repo.recordDocumentStoragePurgeFailure(documentId, {
      attemptCount: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
      deadLetter: false,
      errorMessage: "TRANSIENT: simulated",
    });

    // CloudinaryVerificationDocumentDeletionService itself never throws
    // for a "not found" destroy result (see its own doc comment) — it
    // resolves normally, exactly like `ScriptedDeleter.alwaysSucceeds()`
    // simulates here. This proves the repository/use-case layer treats
    // that resolution as a completed purge, not a special case.
    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, ScriptedDeleter.alwaysSucceeds(), RETRY_CONFIG, null);
    const result = await useCase.execute(10);
    expect(result.succeeded).toBe(1);
  });

  it("transient failure: attempt incremented and nextAttemptAt scheduled, still PENDING", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const documentId = await seedSoftDeletedDocument(profile.id);

    const useCase = new RetryPendingCloudinaryPurgesUseCase(
      repo,
      ScriptedDeleter.alwaysFailsTransient(),
      RETRY_CONFIG,
      null,
    );
    const result = await useCase.execute(10);
    expect(result.retried).toBe(1);

    const row = await fetchPurgeRetryRow(documentId);
    expect(row.storagePurgeStatus).toBe("PENDING");
    expect(row.storagePurgeAttemptCount).toBe(1);
    expect(row.storagePurgeNextAttemptAt).not.toBeNull();
    expect(row.storagePurgeNextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.storagePurgedAt).toBeNull();
  });

  it("maximum attempts: repeated transient failure reaches DEAD_LETTER at maxAttempts, never retried again", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const documentId = await seedSoftDeletedDocument(profile.id);

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt += 1) {
      // Force immediate eligibility regardless of the previous attempt's
      // computed backoff, so this test doesn't need to sleep.
      await forceEligibleNow(documentId);
      const useCase = new RetryPendingCloudinaryPurgesUseCase(
        repo,
        ScriptedDeleter.alwaysFailsTransient(),
        RETRY_CONFIG,
        null,
      );
      await useCase.execute(10);
    }

    const row = await fetchPurgeRetryRow(documentId);
    expect(row.storagePurgeStatus).toBe("DEAD_LETTER");
    expect(row.storagePurgeAttemptCount).toBe(RETRY_CONFIG.maxAttempts);

    // DEAD_LETTER is never picked up by a subsequent claim, even once due.
    await forceEligibleNow(documentId);
    const claimed = await repo.claimPendingStoragePurgeBatch(new Date(), 10);
    expect(claimed.map((d) => d.id)).not.toContain(documentId);
  });

  it("batch limit: the worker never claims more than the configured batch size", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = await seedSoftDeletedDocument(profile.id);
      await repo.recordDocumentStoragePurgeFailure(id, {
        attemptCount: 1,
        nextAttemptAt: new Date(Date.now() - 1000),
        deadLetter: false,
        errorMessage: "TRANSIENT: simulated",
      });
      ids.push(id);
    }

    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, ScriptedDeleter.alwaysSucceeds(), RETRY_CONFIG, null);
    const result = await useCase.execute(2);
    expect(result.claimed).toBe(2);

    const remainingPending = await repo.listDocumentsPendingStoragePurge(profile.id);
    expect(remainingPending).toHaveLength(3);
  });

  it("concurrency: two overlapping claims for the same due batch never claim the same document twice", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { profile } = await seedUserAndProfile();
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = await seedSoftDeletedDocument(profile.id);
      await repo.recordDocumentStoragePurgeFailure(id, {
        attemptCount: 1,
        nextAttemptAt: new Date(Date.now() - 1000),
        deadLetter: false,
        errorMessage: "TRANSIENT: simulated",
      });
      ids.push(id);
    }

    const now = new Date();
    const [batchA, batchB] = await Promise.all([
      repo.claimPendingStoragePurgeBatch(now, 8),
      repo.claimPendingStoragePurgeBatch(now, 8),
    ]);

    const claimedIdsA = batchA.map((d) => d.id);
    const claimedIdsB = batchB.map((d) => d.id);
    const overlap = claimedIdsA.filter((id) => claimedIdsB.includes(id));
    expect(overlap).toHaveLength(0);
    expect(new Set([...claimedIdsA, ...claimedIdsB]).size).toBe(8);
  });

  it("user deletion: the retry claim and purge work using only professionalProfileId, never the User row's PII", async () => {
    const repo = new PrismaProfessionalVerificationRepository();
    const { user, profile } = await seedUserAndProfile();
    const documentId = await seedSoftDeletedDocument(profile.id);
    await repo.recordDocumentStoragePurgeFailure(documentId, {
      attemptCount: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
      deadLetter: false,
      errorMessage: "TRANSIENT: simulated",
    });

    // Simulate exactly what ExecuteAccountErasureUseCase's step 1 does to
    // the User row: anonymize (never hard-delete) — see that use case's
    // own doc comment.
    await prisma.user.update({
      where: { id: user.id },
      data: { name: null, email: `erased-${user.id}@erased.invalid`, passwordHash: null, image: null },
    });

    const useCase = new RetryPendingCloudinaryPurgesUseCase(repo, ScriptedDeleter.alwaysSucceeds(), RETRY_CONFIG, null);
    const result = await useCase.execute(10);
    expect(result.succeeded).toBe(1);

    const row = await fetchPurgeRetryRow(documentId);
    expect(row.storagePurgedAt).not.toBeNull();
  });
});
