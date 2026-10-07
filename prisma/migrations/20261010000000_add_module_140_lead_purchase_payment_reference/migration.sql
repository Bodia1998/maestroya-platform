-- Hand-authored (same caveat as prior migrations in this repo: the column and
-- unique index DDL mirror what Prisma generates; the trigger function cannot be
-- expressed in schema.prisma).
--
-- Module 140 — LEAD_V1 lead-fee payment initiation: provider payment reference.
--
-- Additive and non-destructive: ONE nullable column on "lead_purchases"
-- ("paymentReference"), its unique index, and a replacement of the Module 135/136
-- immutability trigger FUNCTION (the trigger itself is untouched). No row is rewritten
-- or backfilled: every existing purchase keeps "paymentReference" NULL
-- ("no payment attempt initiated").
--
-- "paymentReference" is the payment provider's id of the lead-fee payment attempt
-- (a Stripe PaymentIntent id). It is NOT a payment result and never changes the
-- purchase status; Module 141 owns confirmation.
-- Untouched on purpose: every price/tax/total column and CHECK, the Module 123 partial
-- unique index "lead_purchases_one_active_per_lead_professional", and the status machine.
--
-- Invariants added:
--   1. a provider payment id belongs to at most ONE purchase (unique index; NULLs allowed
--      many times, as in PostgreSQL's default unique semantics);
--   2. "paymentReference" is write-once: NULL -> value is allowed, a set value never changes.
-- Rollback: DROP INDEX "lead_purchases_paymentReference_key";
--           ALTER TABLE "lead_purchases" DROP COLUMN "paymentReference";
--           then re-create lead_purchases_financial_immutable() as in the Module 136 migration.

-- AlterTable
ALTER TABLE "lead_purchases" ADD COLUMN "paymentReference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "lead_purchases_paymentReference_key" ON "lead_purchases"("paymentReference");

-- Immutability: same function as Module 136 plus the write-once provider payment reference.
CREATE OR REPLACE FUNCTION lead_purchases_financial_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW."leadId" IS DISTINCT FROM OLD."leadId"
        OR NEW."professionalProfileId" IS DISTINCT FROM OLD."professionalProfileId"
        OR NEW."price" IS DISTINCT FROM OLD."price"
        OR NEW."currency" IS DISTINCT FROM OLD."currency"
        OR NEW."pricingConfigVersion" IS DISTINCT FROM OLD."pricingConfigVersion"
        OR NEW."pricingRuleVersion" IS DISTINCT FROM OLD."pricingRuleVersion"
        OR NEW."leadPublishedAt" IS DISTINCT FROM OLD."leadPublishedAt"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
        -- tax snapshot is write-once: NULL -> value is allowed, a set value never changes.
        OR (OLD."taxAmount" IS NOT NULL AND NEW."taxAmount" IS DISTINCT FROM OLD."taxAmount")
        OR (OLD."totalAmount" IS NOT NULL AND NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount")
        OR (OLD."taxPolicyVersion" IS NOT NULL AND NEW."taxPolicyVersion" IS DISTINCT FROM OLD."taxPolicyVersion")
        -- Module 140: the provider payment reference is write-once too.
        OR (OLD."paymentReference" IS NOT NULL AND NEW."paymentReference" IS DISTINCT FROM OLD."paymentReference")
    THEN
        RAISE EXCEPTION 'Lead purchase financial snapshot is immutable (purchase %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
