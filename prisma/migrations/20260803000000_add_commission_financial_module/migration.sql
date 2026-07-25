-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev` and
-- have it generate this file from a real diff — see
-- docs/MODULE_21_DISPUTES_SUPPORT.md's own migration for the same confirmed
-- precedent). Mirrors what that command would produce for the schema
-- changes below. Run the real command once you have a database locally to
-- double-check.
--
-- Module 22 — Commission & Financial.
--
-- This migration:
--   1. Adds QuoteItem.category (QuoteItemCategory: LABOR | MATERIALS,
--      default LABOR) — the commission base is labor-only, so a QuoteItem
--      must be classifiable before commission can ever be calculated
--      against it. Defaulting existing/unspecified rows to LABOR is the
--      conservative choice from the platform's own revenue perspective —
--      see schema.prisma's doc comment on QuoteItem.category.
--   2. Extends TransactionType with the more granular ledger entry types
--      Module 22 needs (LABOR_CHARGE, MATERIALS_CHARGE,
--      CUSTOMER_PLATFORM_FEE, PROFESSIONAL_NET_EARNING, PLATFORM_REVENUE,
--      COMMISSION_REVERSAL, DISPUTE_ADJUSTMENT, PAYOUT_REVERSAL). The five
--      pre-existing values (CHARGE/REFUND/PAYOUT/COMMISSION/ADJUSTMENT) are
--      untouched.
--   3. Adds Transaction.idempotencyKey (nullable, unique) — every Module 22
--      ledger write supplies one so a retried financial operation can never
--      create a duplicate entry.
--   4. Adds FinancialAdjustmentType/FinancialAdjustmentStatus enums and the
--      "financial_adjustments" table — the boundary Module 21 (Disputes)
--      uses to request a financial consequence of a resolved dispute
--      without itself moving money. See schema.prisma's doc comment on
--      FinancialAdjustment.
--
-- Nothing existing outside "quote_items"/"transactions" (both additive
-- column changes) is touched. No existing row is backfilled/rewritten:
-- QuoteItem.category has a DEFAULT so existing rows populate automatically;
-- Transaction.idempotencyKey is nullable so existing (currently
-- nonexistent, since no application code writes Transaction yet) rows
-- would be unaffected.

-- ============================================================================
-- 1. QuoteItem.category
-- ============================================================================
CREATE TYPE "QuoteItemCategory" AS ENUM ('LABOR', 'MATERIALS');

ALTER TABLE "quote_items" ADD COLUMN "category" "QuoteItemCategory" NOT NULL DEFAULT 'LABOR';

-- ============================================================================
-- 2. TransactionType — additive new values only.
-- ============================================================================
ALTER TYPE "TransactionType" ADD VALUE 'LABOR_CHARGE';
ALTER TYPE "TransactionType" ADD VALUE 'MATERIALS_CHARGE';
ALTER TYPE "TransactionType" ADD VALUE 'CUSTOMER_PLATFORM_FEE';
ALTER TYPE "TransactionType" ADD VALUE 'PROFESSIONAL_NET_EARNING';
ALTER TYPE "TransactionType" ADD VALUE 'PLATFORM_REVENUE';
ALTER TYPE "TransactionType" ADD VALUE 'COMMISSION_REVERSAL';
ALTER TYPE "TransactionType" ADD VALUE 'DISPUTE_ADJUSTMENT';
ALTER TYPE "TransactionType" ADD VALUE 'PAYOUT_REVERSAL';

-- ============================================================================
-- 3. Transaction.idempotencyKey
-- ============================================================================
ALTER TABLE "transactions" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "transactions_idempotencyKey_key" ON "transactions"("idempotencyKey");

-- ============================================================================
-- 4. FinancialAdjustment
-- ============================================================================
CREATE TYPE "FinancialAdjustmentType" AS ENUM (
    'FULL_REFUND',
    'PARTIAL_REFUND',
    'PROFESSIONAL_PAYOUT_REDUCTION',
    'PROFESSIONAL_PAYOUT_RELEASE',
    'CUSTOMER_COMPENSATION',
    'PLATFORM_FEE_REFUND',
    'COMMISSION_REVERSAL'
);

CREATE TYPE "FinancialAdjustmentStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'FAILED');

CREATE TABLE "financial_adjustments" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "disputeId" UUID,
    "paymentId" UUID,
    "type" "FinancialAdjustmentType" NOT NULL,
    "status" "FinancialAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "reason" TEXT,
    "requestedByUserId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "transactionId" UUID,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financial_adjustments_idempotencyKey_key" ON "financial_adjustments"("idempotencyKey");
CREATE UNIQUE INDEX "financial_adjustments_transactionId_key" ON "financial_adjustments"("transactionId");
CREATE INDEX "financial_adjustments_jobId_idx" ON "financial_adjustments"("jobId");
CREATE INDEX "financial_adjustments_disputeId_idx" ON "financial_adjustments"("disputeId");
CREATE INDEX "financial_adjustments_paymentId_idx" ON "financial_adjustments"("paymentId");
CREATE INDEX "financial_adjustments_status_idx" ON "financial_adjustments"("status");

ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
