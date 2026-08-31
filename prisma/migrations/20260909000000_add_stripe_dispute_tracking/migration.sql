-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260901000000_add_external_webhook_event_idempotency/
-- migration.sql and prior migrations for the same confirmed precedent).
-- Mirrors what that command would produce for the schema change below.
-- Run the real command once you have a database locally to double-check,
-- then delete this comment block.
--
-- Module 86 — Stripe Chargeback & Dispute Handling: a single new, purely
-- additive table (`stripe_disputes`) tracking the Stripe `charge.dispute.*`
-- webhook lifecycle. No existing table is renamed, dropped, or has a
-- column altered/removed. No existing row is rewritten.
--
-- `paymentId`/`jobId`/`financialAdjustmentId` are plain scalar columns on
-- this new table (no Prisma relation object — see the model's own doc
-- comment), but real FK constraints to `payments`/`jobs`/
-- `financial_adjustments` are still added below, matching the precedent
-- `refunds.financialAdjustmentId` (see
-- 20260905000000_add_refund_dispute_financial_execution/migration.sql)
-- and `payouts.paymentId` already set for this exact "scalar column,
-- Prisma-relation-free, but still FK-constrained at the database level"
-- shape.

-- ============================================================================
-- Enums
-- ============================================================================

-- CreateEnum
CREATE TYPE "StripeDisputeStatus" AS ENUM (
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'WON',
  'LOST',
  'WARNING_CLOSED'
);

-- ============================================================================
-- stripe_disputes
-- ============================================================================

-- CreateTable
CREATE TABLE "stripe_disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "paymentId" UUID,
    "jobId" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "reason" TEXT,
    "status" "StripeDisputeStatus" NOT NULL DEFAULT 'NEEDS_RESPONSE',
    "evidenceDueBy" TIMESTAMP(3),
    "financialAdjustmentId" UUID,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stripe_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_disputes_stripeDisputeId_key" ON "stripe_disputes"("stripeDisputeId");
CREATE UNIQUE INDEX "stripe_disputes_financialAdjustmentId_key" ON "stripe_disputes"("financialAdjustmentId");
CREATE INDEX "stripe_disputes_paymentId_idx" ON "stripe_disputes"("paymentId");
CREATE INDEX "stripe_disputes_jobId_idx" ON "stripe_disputes"("jobId");
CREATE INDEX "stripe_disputes_status_idx" ON "stripe_disputes"("status");

-- AddForeignKey (deliberately RESTRICT, matching every other financial FK
-- in this schema — a StripeDispute must never be able to outlive/orphan
-- from its Payment/Job/FinancialAdjustment via a cascading delete).
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_financialAdjustmentId_fkey" FOREIGN KEY ("financialAdjustmentId") REFERENCES "financial_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
