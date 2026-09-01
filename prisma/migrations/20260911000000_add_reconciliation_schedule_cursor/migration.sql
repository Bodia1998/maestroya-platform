-- Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor
--
-- Additive-only migration: one new table (the durable scheduled-sweep
-- checkpoint) and one new composite index on the existing `jobs` table.
-- No existing table, column, constraint, or row is altered, dropped, or
-- backfilled. Safe to run against a production table of any size:
--
--  - `CREATE TABLE` on a brand-new table takes no lock on `jobs` at all.
--  - `CREATE INDEX` (non-CONCURRENTLY) on `jobs` takes a `SHARE` lock,
--    which blocks concurrent writes to `jobs` for the duration of the
--    index build. `CREATE INDEX CONCURRENTLY` is deliberately NOT used
--    here because it cannot run inside a transaction, and Prisma wraps
--    every migration file in one transaction by default — splitting this
--    into a second, non-transactional migration step is a reasonable
--    follow-up for a very large production `jobs` table, but is left as
--    an explicit operational decision (see
--    MODULE_92_IMPLEMENTATION_REPORT.md, "Known limitations") rather than
--    silently changing this migration's transactional guarantees.

-- ============================================================================
-- jobs: composite index supporting the cursor's keyset-pagination query
-- ============================================================================
-- Backs `PrismaReconciliationDataSource.listJobIdsToInspectFromCursor`'s
-- `ORDER BY "createdAt" ASC, "id" ASC` with a `("createdAt", "id") > (?, ?)`
-- keyset predicate — without this index that query falls back to a full
-- sort of every row matching the "has at least one Payment" filter on
-- every single scheduled invocation.
CREATE INDEX "jobs_createdAt_id_idx" ON "jobs" ("createdAt", "id");

-- ============================================================================
-- reconciliation_schedule_cursors
-- ============================================================================
-- One row per named cursor (one name in use today — see
-- `RunScheduledReconciliationSweepUseCase`'s own doc comment). `version`
-- backs the conditional-UPDATE optimistic-concurrency check in
-- `PrismaReconciliationScheduleCursorRepository.advance` — see that
-- repository's own doc comment for why this exists underneath the
-- `DistributedLock` the use case already holds.
CREATE TABLE "reconciliation_schedule_cursors" (
    "id" UUID NOT NULL,
    "cursorKey" TEXT NOT NULL,
    "lastCreatedAt" TIMESTAMP(3),
    "lastJobId" UUID,
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "cycleStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAdvancedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_schedule_cursors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reconciliation_schedule_cursors_cursorKey_key" ON "reconciliation_schedule_cursors" ("cursorKey");
