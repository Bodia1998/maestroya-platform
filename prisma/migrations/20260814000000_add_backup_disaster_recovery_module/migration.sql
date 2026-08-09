-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- docs/MODULE_21_DISPUTES_SUPPORT.md, "Validation Results", for the same
-- confirmed precedent). Mirrors what that command would produce for the
-- schema changes below. Run the real command once you have a database
-- locally to double-check, then delete this comment block.
--
-- Module 54 — Backup & Disaster Recovery.
--
-- Purely additive: two new enums per new table, two new tables. Nothing
-- existing is renamed, dropped, or altered.

-- 1. BackupRecord — one row per backup run. See
--    src/core/domain/entities/backup.ts for the aggregate this backs and
--    prisma-backup-record-repository.ts for the mapping.
CREATE TYPE "BackupTargetKind" AS ENUM ('DATABASE', 'FILE_STORAGE');
CREATE TYPE "BackupTypeKind" AS ENUM ('FULL', 'INCREMENTAL');
CREATE TYPE "BackupStatusKind" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'VERIFIED', 'FAILED', 'RESTORED', 'EXPIRED');

CREATE TABLE "backup_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target" "BackupTargetKind" NOT NULL,
    "type" "BackupTypeKind" NOT NULL,
    "status" "BackupStatusKind" NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "minRetainedBackups" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "locationUri" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backup_records_target_status_idx" ON "backup_records"("target", "status");
CREATE INDEX "backup_records_target_completedAt_idx" ON "backup_records"("target", "completedAt");
CREATE INDEX "backup_records_status_expiresAt_idx" ON "backup_records"("status", "expiresAt");

-- 2. RecoveryExecution — audit trail of every disaster-recovery plan
--    execution (real or drill). Plans themselves are a code-defined
--    catalog (application/services/recovery/disaster-recovery-plans.ts),
--    not a table — see that file's own doc comment.
CREATE TYPE "RecoveryStatusKind" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ABORTED');

CREATE TABLE "recovery_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planId" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "isDrill" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecoveryStatusKind" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "checkpoints" JSONB NOT NULL DEFAULT '[]',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recovery_executions_planId_status_idx" ON "recovery_executions"("planId", "status");
CREATE INDEX "recovery_executions_planId_isDrill_status_idx" ON "recovery_executions"("planId", "isDrill", "status");

-- Module 33 — Security Hardening checklist (see
-- prisma/migrations/20260811000000_enable_row_level_security/migration.sql):
-- every new table must enable RLS with zero policies (default-deny for
-- every role except the Prisma connection's table-owning role). Neither
-- table here carries a userId or any other end-user-scoped column — both
-- are platform-operational data, so "deny every non-owner role entirely"
-- is the correct (and only sensible) policy, identical to every other
-- table in this migration set.
ALTER TABLE "public"."backup_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."recovery_executions" ENABLE ROW LEVEL SECURITY;
