-- Hand-authored (same caveat as prior migrations in this repo: the column DDL
-- mirrors what Prisma generates; the CHECK constraint and the trigger function
-- cannot be expressed in schema.prisma).
--
-- Module 136 — LEAD_V1 lead-fee tax snapshot provenance.
--
-- Additive and non-destructive: ONE nullable column on "lead_purchases"
-- ("taxPolicyVersion"), two CHECK constraints and a replacement of the Module 135
-- immutability trigger FUNCTION (the trigger itself is untouched). No row is
-- rewritten, no value is backfilled or invented: purchases created before
-- Module 136 keep taxAmount / totalAmount / taxPolicyVersion all NULL
-- (= "tax not determined"); 21% IVA is NOT silently assigned to them.
-- The tax amounts themselves are computed by the application's pure lead-fee tax
-- policy and inserted with the purchase; no rate is encoded in SQL.
-- Untouched on purpose: the Module 123 partial unique index
-- "lead_purchases_one_active_per_lead_professional", the three Module 135 CHECKs
-- (incl. total = price + tax and tax >= 0), and the trigger itself. No new index.
--
-- Invariants added:
--   1. the tax snapshot is all-or-nothing: taxAmount, totalAmount and
--      taxPolicyVersion are NULL together or set together;
--   2. a tax snapshot has a non-blank policy version and belongs to a purchase
--      that carries M133 fee provenance (never to a legacy purchase);
--   3. a stored taxPolicyVersion, like taxAmount/totalAmount, is write-once.
-- Rollback: ALTER TABLE "lead_purchases" DROP CONSTRAINT lead_purchases_tax_snapshot_all_or_nothing,
--             DROP CONSTRAINT lead_purchases_tax_snapshot_provenance, DROP COLUMN "taxPolicyVersion";
--           then re-create lead_purchases_financial_immutable() as in the Module 135 migration.

-- AlterTable
ALTER TABLE "lead_purchases" ADD COLUMN "taxPolicyVersion" TEXT;

-- 1. Tax snapshot is written completely or not at all.
ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_tax_snapshot_all_or_nothing" CHECK (
    num_nonnulls("taxAmount", "totalAmount", "taxPolicyVersion") IN (0, 3)
);

-- 2. A tax snapshot names its policy version and only exists on a fee-snapshotted purchase.
ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_tax_snapshot_provenance" CHECK (
    "taxPolicyVersion" IS NULL OR (btrim("taxPolicyVersion") <> '' AND "leadPublishedAt" IS NOT NULL)
);

-- 3. Immutability: same function as Module 135 plus the write-once policy version.
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
    THEN
        RAISE EXCEPTION 'Lead purchase financial snapshot is immutable (purchase %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
