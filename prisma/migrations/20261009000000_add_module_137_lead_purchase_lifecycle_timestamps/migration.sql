-- Hand-authored (same caveat as prior migrations: column DDL mirrors what Prisma generates;
-- the CHECK constraints cannot be expressed in schema.prisma).
--
-- Module 137 — LEAD_V1 LeadPurchase lifecycle audit timestamps.
--
-- Additive and non-destructive: TWO nullable columns on "lead_purchases"
-- ("failedAt", "cancelledAt") and two CHECK constraints. No row is rewritten and no
-- value is backfilled: purchases that already failed/cancelled before Module 137 keep
-- NULL (no history is fabricated). Both columns are stamped once, by the application's
-- status-conditional PENDING_PAYMENT -> FAILED / CANCELLED transition.
-- Untouched on purpose: the Module 123 partial unique index, the Module 135/136 CHECKs
-- and the financial-immutability trigger function (these columns are lifecycle fields,
-- not part of the financial snapshot, so the trigger correctly lets them change). No new index.
--
-- Invariant: a lifecycle timestamp can only exist on a purchase in the matching status.
-- Rollback: ALTER TABLE "lead_purchases" DROP CONSTRAINT lead_purchases_failed_at_status,
--             DROP CONSTRAINT lead_purchases_cancelled_at_status, DROP COLUMN "failedAt", DROP COLUMN "cancelledAt";

-- AlterTable
ALTER TABLE "lead_purchases" ADD COLUMN "failedAt" TIMESTAMP(3), ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_failed_at_status" CHECK (
    "failedAt" IS NULL OR "status" = 'FAILED'
);

ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_cancelled_at_status" CHECK (
    "cancelledAt" IS NULL OR "status" = 'CANCELLED'
);
