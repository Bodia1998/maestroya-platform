-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260822000000_add_job_completion_payment_release_protection/
-- migration.sql and prisma/migrations/20260823000000_add_job_completion_risk_detection/
-- migration.sql for the same confirmed precedent). Mirrors what that
-- command would produce for the schema changes below. Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 68 — Dispute Resolution & Financial Protection.
--
-- Purely additive: two new enums, one new table, one new nullable column
-- (+ FK + index) on the existing "financial_adjustments" table. No
-- existing table is renamed, dropped, or has a column altered/removed. No
-- existing row is rewritten — "resolutionDecisionId" defaults to NULL for
-- every pre-existing FinancialAdjustment row. The Dispute state machine
-- (Module 21), the Financial Ledger (Module 22), and the payment-release
-- decision engine (Module 66) are all untouched at the schema level.

-- ============================================================================
-- Enums
-- ============================================================================

-- CreateEnum
-- The deterministic financial outcome of a Dispute's resolution — see
-- dispute-resolution-financial-outcome.ts's own doc comment for the full
-- mapping from DisputeResolution to this enum.
CREATE TYPE "DisputeFinancialOutcome" AS ENUM (
  'NO_FINANCIAL_ACTION',
  'FULL_RELEASE',
  'FULL_REFUND',
  'PARTIAL_REFUND',
  'HOLD_FOR_REVIEW'
);

-- CreateEnum
-- Whether a DisputeResolutionDecision's required FinancialAdjustment(s)
-- have been applied. PENDING_APPLICATION is the only non-terminal value.
CREATE TYPE "DisputeResolutionDecisionStatus" AS ENUM (
  'PENDING_APPLICATION',
  'APPLIED',
  'PARTIALLY_APPLIED',
  'FAILED'
);

-- ============================================================================
-- dispute_resolution_decisions
-- ============================================================================

-- CreateTable
-- One row per Dispute at most ("disputeId" unique) — the single
-- authoritative, immutable-once-created record of a Dispute's financial
-- resolution. See schema.prisma's DisputeResolutionDecision doc comment.
CREATE TABLE "dispute_resolution_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "disputeId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "paymentId" UUID,
    "resolution" "DisputeResolution" NOT NULL,
    "outcome" "DisputeFinancialOutcome" NOT NULL,
    "status" "DisputeResolutionDecisionStatus" NOT NULL DEFAULT 'PENDING_APPLICATION',
    "reason" TEXT NOT NULL,
    "decidedByUserId" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dispute_resolution_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispute_resolution_decisions_disputeId_key" ON "dispute_resolution_decisions"("disputeId");
CREATE INDEX "dispute_resolution_decisions_jobId_idx" ON "dispute_resolution_decisions"("jobId");
CREATE INDEX "dispute_resolution_decisions_paymentId_idx" ON "dispute_resolution_decisions"("paymentId");
CREATE INDEX "dispute_resolution_decisions_status_idx" ON "dispute_resolution_decisions"("status");

ALTER TABLE "dispute_resolution_decisions"
  ADD CONSTRAINT "dispute_resolution_decisions_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_resolution_decisions"
  ADD CONSTRAINT "dispute_resolution_decisions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_resolution_decisions"
  ADD CONSTRAINT "dispute_resolution_decisions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_resolution_decisions"
  ADD CONSTRAINT "dispute_resolution_decisions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- financial_adjustments.resolutionDecisionId
-- ============================================================================

-- AlterTable
-- Nullable, additive — every existing FinancialAdjustment row (there are
-- none written by application code yet — see this module's audit) gets
-- NULL, meaning "not created via Module 68's atomic resolution flow."
ALTER TABLE "financial_adjustments" ADD COLUMN "resolutionDecisionId" UUID;

CREATE INDEX "financial_adjustments_resolutionDecisionId_idx" ON "financial_adjustments"("resolutionDecisionId");

ALTER TABLE "financial_adjustments"
  ADD CONSTRAINT "financial_adjustments_resolutionDecisionId_fkey" FOREIGN KEY ("resolutionDecisionId") REFERENCES "dispute_resolution_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
