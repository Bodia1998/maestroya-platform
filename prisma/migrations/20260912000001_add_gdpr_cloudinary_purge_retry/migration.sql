-- Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
--
-- Durable retry state for the Cloudinary purge lives on the same
-- `professional_verification_documents` row Module 88 already added
-- `deletedAt`/`storagePurgedAt` to, rather than a parallel shadow table —
-- that row already is the minimal durable record of "this document's
-- storage file needs deleting," and it outlives the owning User row being
-- anonymized (never hard-deleted), so a scheduled retry never depends on
-- the User row existing. See schema.prisma's own doc comment on
-- `ProfessionalVerificationDocument.storagePurgeStatus`.

CREATE TYPE "DocumentStoragePurgeStatus" AS ENUM ('PENDING', 'DEAD_LETTER');

ALTER TABLE "professional_verification_documents"
  ADD COLUMN "storagePurgeStatus" "DocumentStoragePurgeStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "storagePurgeAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "storagePurgeNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "storagePurgeLastError" TEXT,
  ADD COLUMN "storagePurgeLastAttemptedAt" TIMESTAMP(3);

-- Mirrors schema.prisma's own `@@index([storagePurgeStatus,
-- storagePurgeNextAttemptAt, id])` exactly (a plain composite index, not a
-- partial one, so `prisma migrate diff` never reports drift against the
-- declarative schema) — the predicate
-- `claimPendingStoragePurgeBatch` filters and sorts by is:
--   WHERE "deletedAt" IS NOT NULL AND "storagePurgedAt" IS NULL
--     AND "storagePurgeStatus" = 'PENDING'
--     AND ("storagePurgeNextAttemptAt" IS NULL OR "storagePurgeNextAttemptAt" <= now())
--   ORDER BY "storagePurgeNextAttemptAt" ASC NULLS FIRST, "id" ASC
-- This composite index's leading columns (storagePurgeStatus,
-- storagePurgeNextAttemptAt) already make the `PENDING`+due-time scan
-- cheap; a future partial-index optimization (once most historical
-- documents are long purged) is noted as a follow-up in
-- MODULE_94_IMPLEMENTATION_REPORT.md rather than introduced here, to keep
-- the migration and the declarative schema in exact lockstep.
CREATE INDEX "professional_verification_documents_storagePurgeStatus_storag_idx"
  ON "professional_verification_documents" ("storagePurgeStatus", "storagePurgeNextAttemptAt", "id");
