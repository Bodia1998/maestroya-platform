-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- docs/MODULE_21_DISPUTES_SUPPORT.md, "Validation Results", for the same
-- confirmed precedent). Mirrors what that command would produce for the
-- schema changes below. Run the real command once you have a database
-- locally to double-check, then delete this comment block.
--
-- Module 57 — Load Testing & Capacity Planning.
--
-- Restores aggregated-only persistence after a prior pass stripped it
-- entirely (see prisma/schema.prisma's own note above the models this
-- migration creates). Purely additive: two new tables, nothing existing
-- is renamed, dropped, or altered. Neither table stores raw per-request
-- latency samples — both only ever hold already-computed aggregates
-- (min/max/average/median/p95/p99, throughput, resource estimates, error
-- rates) plus, for LoadTestRun, an optional structured report snapshot on
-- the single row that anchors a full `npm run capacity-report` run.

-- 1. LoadTestRun — one row per aggregated scenario execution, plus at
--    most one report-anchoring row per capacity-report run. See
--    src/core/domain/entities/load-test-result.ts for the aggregate this
--    backs and prisma-load-test-result-repository.ts for the mapping.
CREATE TABLE "load_test_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scenarioId" TEXT NOT NULL,
    "scenarioName" TEXT NOT NULL,
    "seed" INTEGER,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "totalRequests" INTEGER NOT NULL,
    "failedRequests" INTEGER NOT NULL,
    "timedOutRequests" INTEGER NOT NULL,
    "retriedRequests" INTEGER NOT NULL,
    "latencyAverageMs" DOUBLE PRECISION NOT NULL,
    "latencyMedianMs" DOUBLE PRECISION NOT NULL,
    "latencyP95Ms" DOUBLE PRECISION NOT NULL,
    "latencyP99Ms" DOUBLE PRECISION NOT NULL,
    "latencyMinMs" DOUBLE PRECISION NOT NULL,
    "latencyMaxMs" DOUBLE PRECISION NOT NULL,
    "requestsPerSecond" DOUBLE PRECISION NOT NULL,
    "transactionsPerSecond" DOUBLE PRECISION NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryMB" DOUBLE PRECISION NOT NULL,
    "dbPoolUtilizationPercent" DOUBLE PRECISION NOT NULL,
    "cacheHitRatioPercent" DOUBLE PRECISION NOT NULL,
    "errorRate" DOUBLE PRECISION NOT NULL,
    "timeoutRate" DOUBLE PRECISION NOT NULL,
    "retryRate" DOUBLE PRECISION NOT NULL,
    "productionReadinessScore" DOUBLE PRECISION,
    "bottlenecks" JSONB,
    "recommendations" JSONB,
    "reportJson" JSONB,
    "reportMarkdown" TEXT,
    "gitCommit" TEXT,
    "gitBranch" TEXT,
    "appVersion" TEXT,
    "environment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_test_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "load_test_runs_scenarioId_executedAt_idx" ON "load_test_runs"("scenarioId", "executedAt");

-- 2. PerformanceBaseline — one labelled, immutable snapshot per
--    (scenarioId, label). See
--    src/core/domain/entities/performance-baseline.ts for the entity this
--    backs and prisma-performance-baseline-repository.ts for the mapping.
CREATE TABLE "performance_baselines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scenarioId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRunId" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "latencyAverageMs" DOUBLE PRECISION NOT NULL,
    "latencyMedianMs" DOUBLE PRECISION NOT NULL,
    "latencyP95Ms" DOUBLE PRECISION NOT NULL,
    "latencyP99Ms" DOUBLE PRECISION NOT NULL,
    "latencyMinMs" DOUBLE PRECISION NOT NULL,
    "latencyMaxMs" DOUBLE PRECISION NOT NULL,
    "requestsPerSecond" DOUBLE PRECISION NOT NULL,
    "transactionsPerSecond" DOUBLE PRECISION NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryMB" DOUBLE PRECISION NOT NULL,
    "dbPoolUtilizationPercent" DOUBLE PRECISION NOT NULL,
    "cacheHitRatioPercent" DOUBLE PRECISION NOT NULL,
    "errorRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_baselines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "performance_baselines_scenarioId_label_key" ON "performance_baselines"("scenarioId", "label");
CREATE INDEX "performance_baselines_scenarioId_capturedAt_idx" ON "performance_baselines"("scenarioId", "capturedAt");

-- Module 33 — Security Hardening checklist (see
-- prisma/migrations/20260811000000_enable_row_level_security/migration.sql):
-- every new table must enable RLS with zero policies (default-deny for
-- every role except the Prisma connection's table-owning role). Neither
-- table here carries a userId or any other end-user-scoped column — both
-- are platform-operational/engineering-tool data, so "deny every
-- non-owner role entirely" is the correct (and only sensible) policy,
-- identical to Module 54's own backup_records/recovery_executions tables.
ALTER TABLE "public"."load_test_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."performance_baselines" ENABLE ROW LEVEL SECURITY;
