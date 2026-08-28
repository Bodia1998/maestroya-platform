-- Module 80 — Financial Reconciliation & Observability
-- Additive-only migration: two new tables, six new enums, and two new
-- nullable back-relation columns are added below (via the FKs on the new
-- tables — no column is added to any existing table). No existing table,
-- column, or row is altered, dropped, or backfilled.
--
-- Every discrepancy entity-reference column (entityId/jobId/paymentId/
-- invoiceId/payoutId/refundId/creditNoteId) is DELIBERATELY left without a
-- foreign-key constraint to its referenced table — see the schema's own
-- doc comment on this section for why (this module must be able to record
-- "this record references a nonexistent X", which a FK would forbid).

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE "ReconciliationScope" AS ENUM ('FULL', 'PAYMENT', 'COMMISSION', 'TAX', 'INVOICE', 'PAYOUT', 'REFUND', 'CREDIT_NOTE', 'PROVIDER');

CREATE TYPE "DiscrepancyEntityType" AS ENUM ('PAYMENT', 'COMMISSION', 'TAX_BREAKDOWN', 'INVOICE', 'PAYOUT', 'REFUND', 'CREDIT_NOTE', 'PROVIDER_EVENT');

CREATE TYPE "DiscrepancyCategory" AS ENUM (
    'PAYMENT_MISSING_JOB_OR_QUOTE',
    'PAYMENT_AMOUNT_MISMATCH',
    'PAYMENT_SUCCESSFUL_WITHOUT_RELATIONSHIP',
    'DUPLICATE_PAYMENT',
    'PAYMENT_CURRENCY_MISMATCH',
    'COMMISSION_RATE_MISMATCH',
    'COMMISSION_AMOUNT_MISMATCH',
    'COMMISSION_PROFESSIONAL_NET_MISMATCH',
    'COMMISSION_ALLOCATION_MISMATCH',
    'COMMISSION_LEDGER_INCONSISTENT',
    'TAX_TAXABLE_BASE_MISMATCH',
    'TAX_RATE_MISMATCH',
    'TAX_AMOUNT_MISMATCH',
    'TAX_PROFESSIONAL_SIDE_MISMATCH',
    'TAX_CUSTOMER_SIDE_MISMATCH',
    'TAX_IRPF_MISMATCH',
    'TAX_INVOICE_TOTAL_MISMATCH',
    'INVOICE_INVALID_JOB_REFERENCE',
    'INVOICE_WRONG_PARTY',
    'INVOICE_AMOUNT_INCONSISTENT_WITH_TAX_BREAKDOWN',
    'INVOICE_TAX_AMOUNT_INCONSISTENT',
    'INVOICE_COMMISSION_AMOUNT_INCONSISTENT',
    'INVOICE_ISSUED_WITHOUT_PREREQUISITES',
    'INVOICE_PAID_WITHOUT_PAYOUT',
    'DUPLICATE_ACTIVE_INVOICE',
    'INVOICE_NUMBERING_ANOMALY',
    'INVOICE_MISSING_IMMUTABLE_METADATA',
    'INVOICE_CREDIT_NOTE_INCONSISTENT',
    'PAYOUT_MISSING_ELIGIBLE_RELATIONSHIP',
    'PAYOUT_AMOUNT_MISMATCH',
    'PAYOUT_EXCEEDS_PAYABLE_AMOUNT',
    'PAYOUT_MISSING_REQUIRED_INVOICE_STATE',
    'DUPLICATE_PAYOUT',
    'PAYOUT_CURRENCY_MISMATCH',
    'PAYOUT_PROVIDER_REFERENCE_MISMATCH',
    'REFUND_EXCEEDS_REFUNDABLE_AMOUNT',
    'DUPLICATE_REFUND',
    'REFUND_AMOUNT_OR_CURRENCY_MISMATCH',
    'REFUND_MISSING_PAYMENT_RELATIONSHIP',
    'REFUND_STATE_INCONSISTENT_WITH_PAYMENT',
    'REFUND_CREDIT_NOTE_INCONSISTENT',
    'CREDIT_NOTE_INVALID_INVOICE_REFERENCE',
    'CREDIT_NOTE_WRONG_PARTY',
    'CREDIT_NOTE_EXCEEDS_REMAINING_CREDITABLE_AMOUNT',
    'CREDIT_NOTE_TAX_REVERSAL_MISMATCH',
    'CREDIT_NOTE_ISSUED_WITHOUT_REQUIRED_STATE',
    'DUPLICATE_CREDIT_NOTE',
    'CREDIT_NOTE_NUMBERING_ANOMALY',
    'CREDIT_NOTE_AMOUNT_OR_CURRENCY_MISMATCH',
    'PROVIDER_STATE_UNKNOWN',
    'PROVIDER_LOCAL_STATE_MISMATCH',
    'PROVIDER_AMOUNT_MISMATCH'
);

CREATE TYPE "DiscrepancySeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

CREATE TYPE "DiscrepancyResolutionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- ============================================================================
-- reconciliation_runs
-- ============================================================================

CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "scope" "ReconciliationScope" NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "recordsInspected" INTEGER NOT NULL DEFAULT 0,
    "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "parametersHash" TEXT NOT NULL,
    "triggeredByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reconciliation_runs_recordsInspected_check" CHECK ("recordsInspected" >= 0),
    CONSTRAINT "reconciliation_runs_discrepancyCount_check" CHECK ("discrepancyCount" >= 0),
    CONSTRAINT "reconciliation_runs_durationMs_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

ALTER TABLE "reconciliation_runs"
    ADD CONSTRAINT "reconciliation_runs_triggeredByUserId_fkey"
        FOREIGN KEY ("triggeredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "reconciliation_runs_status_idx" ON "reconciliation_runs"("status");
CREATE INDEX "reconciliation_runs_startedAt_idx" ON "reconciliation_runs"("startedAt");
CREATE INDEX "reconciliation_runs_scope_idx" ON "reconciliation_runs"("scope");

-- ============================================================================
-- reconciliation_discrepancies
-- ============================================================================

CREATE TABLE "reconciliation_discrepancies" (
    "id" UUID NOT NULL,
    "detectedByRunId" UUID NOT NULL,
    "lastSeenRunId" UUID NOT NULL,
    "entityType" "DiscrepancyEntityType" NOT NULL,
    "entityId" UUID,
    "jobId" UUID,
    "paymentId" UUID,
    "invoiceId" UUID,
    "payoutId" UUID,
    "refundId" UUID,
    "creditNoteId" UUID,
    "category" "DiscrepancyCategory" NOT NULL,
    "severity" "DiscrepancySeverity" NOT NULL,
    "expectedValue" DECIMAL(14,2),
    "actualValue" DECIMAL(14,2),
    "differenceValue" DECIMAL(14,2),
    "currency" TEXT,
    "explanation" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "resolutionStatus" "DiscrepancyResolutionStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "resolutionMetadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id"),
    -- A RESOLVED row must always carry its resolution evidence together;
    -- an OPEN row must never carry any of it (no partial resolution state).
    CONSTRAINT "reconciliation_discrepancies_resolution_check" CHECK (
        ("resolutionStatus" = 'OPEN' AND "resolvedByUserId" IS NULL AND "resolvedAt" IS NULL AND "resolutionReason" IS NULL)
        OR
        ("resolutionStatus" = 'RESOLVED' AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolutionReason" IS NOT NULL)
    )
);

ALTER TABLE "reconciliation_discrepancies"
    ADD CONSTRAINT "reconciliation_discrepancies_detectedByRunId_fkey"
        FOREIGN KEY ("detectedByRunId") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "reconciliation_discrepancies_lastSeenRunId_fkey"
        FOREIGN KEY ("lastSeenRunId") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "reconciliation_discrepancies_resolvedByUserId_fkey"
        FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "reconciliation_discrepancies_detectedByRunId_idx" ON "reconciliation_discrepancies"("detectedByRunId");
CREATE INDEX "reconciliation_discrepancies_severity_idx" ON "reconciliation_discrepancies"("severity");
CREATE INDEX "reconciliation_discrepancies_resolutionStatus_idx" ON "reconciliation_discrepancies"("resolutionStatus");
CREATE INDEX "reconciliation_discrepancies_category_idx" ON "reconciliation_discrepancies"("category");
CREATE INDEX "reconciliation_discrepancies_jobId_idx" ON "reconciliation_discrepancies"("jobId");
CREATE INDEX "reconciliation_discrepancies_fingerprint_idx" ON "reconciliation_discrepancies"("fingerprint");

-- The idempotency/concurrency backstop (see
-- ReconciliationDiscrepancyRepository.createOrTouch's own doc comment):
-- at most one OPEN discrepancy per fingerprint, database-enforced. A
-- fingerprint may recur any number of times among RESOLVED rows (each a
-- distinct historical occurrence, never merged or deleted), but never more
-- than once while still OPEN.
CREATE UNIQUE INDEX "reconciliation_discrepancies_open_fingerprint_unique"
    ON "reconciliation_discrepancies"("fingerprint")
    WHERE "resolutionStatus" = 'OPEN';
