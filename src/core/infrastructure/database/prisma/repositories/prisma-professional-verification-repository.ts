import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type { VerificationStatusValue } from "@/domain/repositories/professional-repository";
import type {
  AddVerificationDocumentData,
  AdminVerificationDetail,
  AdminVerificationListItem,
  ListAdminVerificationsOptions,
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
  ProfessionalVerificationWithDocuments,
  UpdateVerificationStatusData,
  VerificationDocumentRecord,
} from "@/domain/repositories/professional-verification-repository";
import type {
  ProfessionalVerificationStatusValue,
  VerificationDocumentStatusValue,
  VerificationDocumentTypeValue,
  VerificationProviderValue,
} from "@/domain/services/professional-verification-rules";

/**
 * Professional Verification module (Module 17): Prisma implementation of
 * ProfessionalVerificationRepository, backed by the `professional_
 * verifications` / `professional_verification_documents` tables added by
 * this module's migration. Same "narrow SELECT + toRecord mapper" convention
 * as every other Prisma repository in this codebase.
 */

const VERIFICATION_SELECT = {
  id: true,
  professionalProfileId: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  rejectionReason: true,
  resubmissionReason: true,
  expiresAt: true,
  // Module 59 — Professional Verification (Persona).
  provider: true,
  providerVerificationId: true,
  providerStatus: true,
  providerSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DOCUMENT_SELECT = {
  id: true,
  verificationId: true,
  type: true,
  status: true,
  fileUrl: true,
  originalFilename: true,
  mimeType: true,
  fileSizeBytes: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  // Module 88 fields — already present in the generated Prisma Client, safe
  // to select typed. The five Module 94 purge-retry fields
  // (storagePurgeStatus/storagePurgeAttemptCount/storagePurgeNextAttemptAt/
  // storagePurgeLastError/storagePurgeLastAttemptedAt) are deliberately NOT
  // selected here — see `toDocumentRecord`'s own doc comment for why.
  deletedAt: true,
  storagePurgedAt: true,
} as const;

type VerificationRow = {
  id: string;
  professionalProfileId: string;
  status: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  resubmissionReason: string | null;
  expiresAt: Date | null;
  provider: string;
  providerVerificationId: string | null;
  providerStatus: string | null;
  providerSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DocumentRow = {
  id: string;
  verificationId: string;
  type: string;
  status: string;
  fileUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  storagePurgedAt: Date | null;
};

/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
 *
 * The full row shape for the five purge-retry columns, read via raw SQL
 * (see this file's own top-of-file doc comment on why: the generated
 * Prisma Client in every environment this module was developed in
 * predates this migration and cannot be regenerated there — the same
 * pre-existing constraint `PrismaPayoutRepository`/
 * `PrismaExternalWebhookEventRepository`/`PrismaStripeDisputeRepository`
 * already document on their own raw-SQL methods). Every method that
 * actually drives retry logic (`listDocumentsPendingStoragePurge`,
 * `recordDocumentStoragePurgeFailure`, `claimPendingStoragePurgeBatch`,
 * `markDocumentStoragePurged`) uses this row shape and is therefore fully
 * accurate. `addDocument`/`findDocumentById`/`listDocuments`/
 * `findActiveWithDocumentsByProfessionalProfileId` — the professional's
 * own document upload/dashboard and the admin review queue — keep their
 * pre-existing typed `DOCUMENT_SELECT` and report safe defaults
 * (`PENDING`/0/null/null/null) for these five fields in
 * `toDocumentRecord` below, which is accurate for every row those paths
 * actually return: `deletedAt: null` there always implies "GDPR erasure
 * has never touched this document," which in turn implies purge-retry
 * state is still at its column defaults (see `eraseDocumentsForProfessionalProfile`'s
 * own doc comment: "Every existing read path for this model ... [is]
 * never used once a case's owner has been erased"). Once
 * `prisma generate` is re-run against this migration in an environment
 * with registry access, `DOCUMENT_SELECT` can be widened to select these
 * columns directly and this split removed — see
 * MODULE_94_IMPLEMENTATION_REPORT.md, "Known limitations."
 */
type PurgeRetryRow = DocumentRow & {
  storagePurgeStatus: "PENDING" | "DEAD_LETTER";
  storagePurgeAttemptCount: number;
  storagePurgeNextAttemptAt: Date | null;
  storagePurgeLastError: string | null;
  storagePurgeLastAttemptedAt: Date | null;
};

function toVerificationRecord(row: VerificationRow): ProfessionalVerificationRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    status: row.status as ProfessionalVerificationStatusValue,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    rejectionReason: row.rejectionReason,
    resubmissionReason: row.resubmissionReason,
    expiresAt: row.expiresAt,
    provider: row.provider as VerificationProviderValue,
    providerVerificationId: row.providerVerificationId,
    providerStatus: row.providerStatus,
    providerSyncedAt: row.providerSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDocumentRecord(row: DocumentRow): VerificationDocumentRecord {
  return {
    id: row.id,
    verificationId: row.verificationId,
    type: row.type as VerificationDocumentTypeValue,
    status: row.status as VerificationDocumentStatusValue,
    fileUrl: row.fileUrl,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    storagePurgedAt: row.storagePurgedAt,
    // See `PurgeRetryRow`'s own doc comment: safe defaults, accurate for
    // every row this mapper is actually called with (deletedAt: null).
    storagePurgeStatus: "PENDING",
    storagePurgeAttemptCount: 0,
    storagePurgeNextAttemptAt: null,
    storagePurgeLastError: null,
    storagePurgeLastAttemptedAt: null,
  };
}

function toPurgeRetryRecord(row: PurgeRetryRow): VerificationDocumentRecord {
  return {
    ...toDocumentRecord(row),
    storagePurgeStatus: row.storagePurgeStatus,
    storagePurgeAttemptCount: row.storagePurgeAttemptCount,
    storagePurgeNextAttemptAt: row.storagePurgeNextAttemptAt,
    storagePurgeLastError: row.storagePurgeLastError,
    storagePurgeLastAttemptedAt: row.storagePurgeLastAttemptedAt,
  };
}

/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
 *
 * How long a document claimed by `claimPendingStoragePurgeBatch` stays
 * excluded from a SUBSEQUENT claim, independent of `FOR UPDATE SKIP
 * LOCKED`. Row locks from that clause are only held for the duration of
 * the claim statement itself (a single, auto-committing round trip) —
 * they do NOT cover the time the caller then spends actually calling
 * Cloudinary and recording an outcome (`recordDocumentStoragePurgeFailure`/
 * `markDocumentStoragePurged`, both called synchronously afterward, see
 * `RetryPendingCloudinaryPurgesUseCase.runBatch`). Without this lease, a
 * second claim landing in exactly that gap — genuinely concurrent, or
 * simply running moments after the first claim statement already
 * committed and released its locks — sees the row as still
 * `storagePurgeStatus = 'PENDING'` with its `storagePurgeNextAttemptAt`
 * unchanged, and claims it again: a real concurrent run of this exact
 * scenario reproduced a full double-claim.
 *
 * Comfortably longer than one document's Cloudinary `destroy` call is
 * expected to take, matching every other lease/lock TTL already used in
 * this codebase for the same reason (`RunScheduledReconciliationSweepUseCase.LOCK_TTL_MS`,
 * `RetryPendingCloudinaryPurgesUseCase.LOCK_TTL_MS`) — a safety net for a
 * crashed/stalled worker, never a scheduling mechanism. Always
 * overwritten with the REAL outcome (a computed backoff time, or
 * cleared to null) by `recordDocumentStoragePurgeFailure`/
 * `markDocumentStoragePurged`, called synchronously right after the
 * claim under normal operation — so this lease value is only ever
 * actually observed by another claim in the crash/stall case it exists
 * for.
 */
const STORAGE_PURGE_CLAIM_LEASE_MS = 5 * 60 * 1000;

export class PrismaProfessionalVerificationRepository implements ProfessionalVerificationRepository {
  async create(professionalProfileId: string): Promise<ProfessionalVerificationRecord> {
    const row = await prisma.professionalVerification.create({
      data: { professionalProfileId, status: "DRAFT" },
      select: VERIFICATION_SELECT,
    });
    return toVerificationRecord(row);
  }

  async findActiveByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalVerificationRecord | null> {
    const row = await prisma.professionalVerification.findFirst({
      where: { professionalProfileId, status: { not: "EXPIRED" } },
      orderBy: { createdAt: "desc" },
      select: VERIFICATION_SELECT,
    });
    return row ? toVerificationRecord(row) : null;
  }

  async findActiveWithDocumentsByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalVerificationWithDocuments | null> {
    const row = await prisma.professionalVerification.findFirst({
      where: { professionalProfileId, status: { not: "EXPIRED" } },
      orderBy: { createdAt: "desc" },
      select: { ...VERIFICATION_SELECT, documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } } },
    });
    if (!row) return null;
    const { documents, ...verification } = row;
    return { ...toVerificationRecord(verification), documents: documents.map(toDocumentRecord) };
  }

  async findById(id: string): Promise<ProfessionalVerificationRecord | null> {
    const row = await prisma.professionalVerification.findUnique({ where: { id }, select: VERIFICATION_SELECT });
    return row ? toVerificationRecord(row) : null;
  }

  async updateStatus(id: string, data: UpdateVerificationStatusData): Promise<ProfessionalVerificationRecord> {
    const row = await prisma.professionalVerification.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.submittedAt !== undefined ? { submittedAt: data.submittedAt } : {}),
        ...(data.reviewedAt !== undefined ? { reviewedAt: data.reviewedAt } : {}),
        ...(data.reviewedByUserId !== undefined ? { reviewedByUserId: data.reviewedByUserId } : {}),
        ...(data.rejectionReason !== undefined ? { rejectionReason: data.rejectionReason } : {}),
        ...(data.resubmissionReason !== undefined ? { resubmissionReason: data.resubmissionReason } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
        ...(data.provider !== undefined ? { provider: data.provider } : {}),
        ...(data.providerVerificationId !== undefined ? { providerVerificationId: data.providerVerificationId } : {}),
        ...(data.providerStatus !== undefined ? { providerStatus: data.providerStatus } : {}),
        ...(data.providerSyncedAt !== undefined ? { providerSyncedAt: data.providerSyncedAt } : {}),
      },
      select: VERIFICATION_SELECT,
    });
    return toVerificationRecord(row);
  }

  async addDocument(data: AddVerificationDocumentData): Promise<VerificationDocumentRecord> {
    const row = await prisma.professionalVerificationDocument.create({
      data: {
        verificationId: data.verificationId,
        type: data.type,
        fileUrl: data.fileUrl,
        originalFilename: data.originalFilename,
        mimeType: data.mimeType,
        fileSizeBytes: data.fileSizeBytes,
      },
      select: DOCUMENT_SELECT,
    });
    return toDocumentRecord(row);
  }

  async findDocumentById(id: string): Promise<VerificationDocumentRecord | null> {
    const row = await prisma.professionalVerificationDocument.findUnique({ where: { id }, select: DOCUMENT_SELECT });
    return row ? toDocumentRecord(row) : null;
  }

  async listDocuments(verificationId: string): Promise<VerificationDocumentRecord[]> {
    const rows = await prisma.professionalVerificationDocument.findMany({
      where: { verificationId },
      orderBy: { createdAt: "asc" },
      select: DOCUMENT_SELECT,
    });
    return rows.map(toDocumentRecord);
  }

  async countDocuments(verificationId: string): Promise<number> {
    return prisma.professionalVerificationDocument.count({ where: { verificationId } });
  }

  async removeDocument(id: string): Promise<void> {
    await prisma.professionalVerificationDocument.delete({ where: { id } });
  }

  async setProfileVerificationStatus(
    professionalProfileId: string,
    status: VerificationStatusValue,
    verifiedAt: Date | null,
  ): Promise<void> {
    await prisma.professionalProfile.update({
      where: { id: professionalProfileId },
      data: { verificationStatus: status, verifiedAt },
    });
  }

  async listForAdmin(options: ListAdminVerificationsOptions): Promise<AdminVerificationListItem[]> {
    const where: Prisma.ProfessionalVerificationWhereInput = options.status ? { status: options.status } : {};
    const rows = await prisma.professionalVerification.findMany({
      where,
      orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
      select: {
        ...VERIFICATION_SELECT,
        professionalProfile: {
          select: { businessName: true, user: { select: { name: true, email: true } } },
        },
      },
    });
    return rows.map((row) => {
      const { professionalProfile, ...verification } = row;
      return {
        ...toVerificationRecord(verification),
        businessName: professionalProfile.businessName,
        professionalName: professionalProfile.user.name,
        professionalEmail: professionalProfile.user.email,
      } satisfies AdminVerificationListItem;
    });
  }

  async getDetailForAdmin(id: string): Promise<AdminVerificationDetail | null> {
    const row = await prisma.professionalVerification.findUnique({
      where: { id },
      select: {
        ...VERIFICATION_SELECT,
        documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } },
        professionalProfile: {
          select: { businessName: true, userId: true, user: { select: { name: true, email: true } } },
        },
      },
    });
    if (!row) return null;
    const { documents, professionalProfile, ...verification } = row;
    const record = toVerificationRecord(verification);
    return {
      ...record,
      businessName: professionalProfile.businessName,
      professionalName: professionalProfile.user.name,
      professionalEmail: professionalProfile.user.email,
      professionalUserId: professionalProfile.userId,
      documents: documents.map(toDocumentRecord),
    };
  }

  async findExpirable(now: Date): Promise<ProfessionalVerificationRecord[]> {
    const rows = await prisma.professionalVerification.findMany({
      where: { status: "APPROVED", expiresAt: { lte: now } },
      select: VERIFICATION_SELECT,
    });
    return rows.map(toVerificationRecord);
  }

  // --- Module 59 — Professional Verification (Persona) ---

  async findByProviderVerificationId(providerVerificationId: string): Promise<ProfessionalVerificationRecord | null> {
    const row = await prisma.professionalVerification.findFirst({
      where: { provider: { not: "MANUAL" }, providerVerificationId },
      select: VERIFICATION_SELECT,
    });
    return row ? toVerificationRecord(row) : null;
  }

  async findSyncable(): Promise<ProfessionalVerificationRecord[]> {
    const rows = await prisma.professionalVerification.findMany({
      where: {
        provider: { not: "MANUAL" },
        providerVerificationId: { not: null },
        status: { in: ["PENDING", "UNDER_REVIEW"] },
      },
      select: VERIFICATION_SELECT,
    });
    return rows.map(toVerificationRecord);
  }

  // --- Module 88: GDPR Erasure Execution & Document Retention ---

  async eraseDocumentsForProfessionalProfile(professionalProfileId: string): Promise<VerificationDocumentRecord[]> {
    const rows = await prisma.professionalVerificationDocument.findMany({
      where: {
        deletedAt: null,
        verification: { professionalProfileId },
      },
      select: DOCUMENT_SELECT,
    });
    if (rows.length === 0) return [];

    await prisma.professionalVerificationDocument.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { deletedAt: new Date() },
    });
    return rows.map(toDocumentRecord);
  }

  async listDocumentsPendingStoragePurge(professionalProfileId: string): Promise<VerificationDocumentRecord[]> {
    // Module 94: raw SQL — see `PurgeRetryRow`'s own doc comment. Excludes
    // `DEAD_LETTER` rows: those require manual operator review, and
    // re-running the erasure use case (this method's only caller) must
    // not silently re-attempt a purge already given up on — that stays
    // `RetryPendingCloudinaryPurgesUseCase`'s job, and even it only
    // reaches `DEAD_LETTER` rows through an explicit operator action, not
    // its own scheduled claim (see `claimPendingStoragePurgeBatch`'s own
    // `WHERE` clause, which filters the same status).
    const rows = await prisma.$queryRaw<PurgeRetryRow[]>`
      SELECT d."id", d."verificationId", d."type", d."status", d."fileUrl",
             d."originalFilename", d."mimeType", d."fileSizeBytes", d."rejectionReason",
             d."createdAt", d."updatedAt", d."deletedAt", d."storagePurgedAt",
             d."storagePurgeStatus", d."storagePurgeAttemptCount",
             d."storagePurgeNextAttemptAt", d."storagePurgeLastError", d."storagePurgeLastAttemptedAt"
      FROM "professional_verification_documents" d
      INNER JOIN "professional_verifications" v ON v."id" = d."verificationId"
      WHERE v."professionalProfileId" = ${professionalProfileId}::uuid
        AND d."deletedAt" IS NOT NULL
        AND d."storagePurgedAt" IS NULL
        AND d."storagePurgeStatus" = 'PENDING'
    `;
    return rows.map(toPurgeRetryRecord);
  }

  async markDocumentStoragePurged(documentId: string): Promise<void> {
    // Module 94: also resets retry bookkeeping — see this interface
    // method's own doc comment. Raw SQL because the three purge-retry
    // columns being reset aren't in the (stale, in this sandbox)
    // generated Prisma Client — see `PurgeRetryRow`'s own doc comment.
    await prisma.$executeRaw`
      UPDATE "professional_verification_documents"
      SET "storagePurgedAt" = now(),
          "storagePurgeStatus" = 'PENDING',
          "storagePurgeAttemptCount" = 0,
          "storagePurgeNextAttemptAt" = NULL,
          "storagePurgeLastError" = NULL
      WHERE "id" = ${documentId}::uuid
    `;
  }

  // --- Module 94: GDPR Cloudinary Purge Retry & Durable Erasure Completion ---

  async recordDocumentStoragePurgeFailure(
    documentId: string,
    data: { attemptCount: number; nextAttemptAt: Date | null; deadLetter: boolean; errorMessage: string },
  ): Promise<void> {
    // Truncated defensively: this column is `TEXT`, but an unbounded
    // provider error message (or one an attacker-controlled upstream
    // somehow inflated) has no business growing this row without limit —
    // see `storagePurgeLastError`'s own doc comment ("classified,
    // redacted message"). The classifier (`classifyCloudinaryPurgeError`)
    // is the thing actually responsible for redaction; this is a second,
    // cheap safety net.
    const errorMessage = data.errorMessage.slice(0, 2000);
    await prisma.$executeRaw`
      UPDATE "professional_verification_documents"
      SET "storagePurgeStatus" = ${data.deadLetter ? "DEAD_LETTER" : "PENDING"}::"DocumentStoragePurgeStatus",
          "storagePurgeAttemptCount" = ${data.attemptCount},
          "storagePurgeNextAttemptAt" = ${data.nextAttemptAt},
          "storagePurgeLastError" = ${errorMessage},
          "storagePurgeLastAttemptedAt" = now()
      WHERE "id" = ${documentId}::uuid
        AND "storagePurgedAt" IS NULL
    `;
  }

  async claimPendingStoragePurgeBatch(now: Date, batchSize: number): Promise<VerificationDocumentRecord[]> {
    // Module 94: the atomic claim — see this interface method's own doc
    // comment, and `STORAGE_PURGE_CLAIM_LEASE_MS`'s own doc comment
    // above, for the full concurrency-safety reasoning. One statement:
    // a CTE selects the due batch with `FOR UPDATE SKIP LOCKED` (so a
    // concurrent invocation's own claim simply skips whatever this one
    // already has row-locked, never blocking or double-claiming), then
    // the outer `UPDATE ... FROM ... RETURNING` stamps
    // `storagePurgeLastAttemptedAt` AND advances `storagePurgeNextAttemptAt`
    // to a short-lived claim lease on exactly those rows, and returns
    // their full current state in the same round trip.
    //
    // The lease (`storagePurgeNextAttemptAt` set forward, not just
    // `storagePurgeLastAttemptedAt`) is what actually closes the race:
    // `FOR UPDATE SKIP LOCKED` only protects rows for the duration of
    // THIS statement's own transaction — it says nothing about a second
    // claim statement that starts moments after this one has already
    // committed and released its locks, while the caller is still busy
    // calling Cloudinary for each claimed document. Without advancing
    // `storagePurgeNextAttemptAt` here, that second claim's WHERE clause
    // would still see these rows as due and claim them again. Bumping it
    // forward here is always overwritten with the real outcome
    // (`recordDocumentStoragePurgeFailure`'s computed backoff, or
    // `markDocumentStoragePurged`'s NULL) moments later under normal
    // operation — see those methods' own `WHERE "storagePurgedAt" IS
    // NULL` / unconditional overwrite, neither of which is gated on the
    // lease value this sets.
    const leaseExpiresAt = new Date(now.getTime() + STORAGE_PURGE_CLAIM_LEASE_MS);
    const rows = await prisma.$queryRaw<PurgeRetryRow[]>`
      WITH claimed AS (
        SELECT "id"
        FROM "professional_verification_documents"
        WHERE "deletedAt" IS NOT NULL
          AND "storagePurgedAt" IS NULL
          AND "storagePurgeStatus" = 'PENDING'
          AND ("storagePurgeNextAttemptAt" IS NULL OR "storagePurgeNextAttemptAt" <= ${now})
        ORDER BY "storagePurgeNextAttemptAt" ASC NULLS FIRST, "id" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "professional_verification_documents" d
      SET "storagePurgeLastAttemptedAt" = ${now},
          "storagePurgeNextAttemptAt" = ${leaseExpiresAt}
      FROM claimed
      WHERE d."id" = claimed."id"
      RETURNING d."id", d."verificationId", d."type", d."status", d."fileUrl",
                d."originalFilename", d."mimeType", d."fileSizeBytes", d."rejectionReason",
                d."createdAt", d."updatedAt", d."deletedAt", d."storagePurgedAt",
                d."storagePurgeStatus", d."storagePurgeAttemptCount",
                d."storagePurgeNextAttemptAt", d."storagePurgeLastError", d."storagePurgeLastAttemptedAt"
    `;
    return rows.map(toPurgeRetryRecord);
  }
}
