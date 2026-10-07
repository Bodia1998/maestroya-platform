-- Hand-authored (same caveat as prior migrations in this repo: the column DDL
-- mirrors what Prisma generates; the CHECK constraints and the trigger cannot
-- be expressed in schema.prisma).
--
-- Module 135 — LeadPurchase financial snapshot (immutability) foundation.
--
-- Additive and non-destructive: five NULLABLE columns on "lead_purchases"
-- (+ CHECK constraints + one immutability trigger). No row is rewritten, no
-- value is backfilled or invented: existing purchases keep every new column
-- NULL (= "created before Module 135, no snapshot provenance"); their
-- existing "price"/"currency" are already the agreed fee and become immutable
-- from now on. No new index: idempotency/uniqueness is ALREADY enforced by the
-- Module 123 partial unique index "lead_purchases_one_active_per_lead_professional"
-- (leadId, professionalProfileId) WHERE status IN ('PENDING_PAYMENT','CONFIRMED')
-- which is deliberately left untouched (terminal rows keep history and allow a
-- retry after FAILED/CANCELLED).
--
-- Invariants protected:
--   1. provenance is all-or-nothing (never half written);
--   2. a purchase that carries provenance has a positive EUR fee (what M133
--      can publish);
--   3. tax is a neutral placeholder: NULL (undetermined, Module 136 decides) or
--      a consistent pair with totalAmount = price + taxAmount;
--   4. the agreed fee and its provenance never change after insert; tax/total
--      are write-once (NULL -> value once). Status/timestamps stay mutable.
-- Rollback: DROP TRIGGER lead_purchases_financial_immutable_trg ON "lead_purchases";
--           DROP FUNCTION lead_purchases_financial_immutable();
--           ALTER TABLE "lead_purchases" DROP CONSTRAINT (3 checks), DROP COLUMN (5 columns).

-- AlterTable
ALTER TABLE "lead_purchases"
    ADD COLUMN "pricingConfigVersion" TEXT,
    ADD COLUMN "pricingRuleVersion" TEXT,
    ADD COLUMN "leadPublishedAt" TIMESTAMP(3),
    ADD COLUMN "taxAmount" DECIMAL(10,2),
    ADD COLUMN "totalAmount" DECIMAL(10,2);

-- 1. Snapshot provenance is written completely or not at all.
ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_snapshot_all_or_nothing" CHECK (
    num_nonnulls("pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt") IN (0, 3)
);

-- 2. A snapshotted purchase carries a sane fee (M133 only publishes price > 0, EUR).
ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_snapshot_fee_valid" CHECK (
    "leadPublishedAt" IS NULL OR ("price" > 0 AND "currency" = 'EUR')
);

-- 3. Neutral tax placeholders: both NULL (undetermined) or a consistent pair.
ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_tax_total_consistent" CHECK (
    ("taxAmount" IS NULL AND "totalAmount" IS NULL)
    OR ("taxAmount" IS NOT NULL AND "totalAmount" IS NOT NULL AND "taxAmount" >= 0 AND "totalAmount" = "price" + "taxAmount")
);

-- 4. The agreed commercial terms never change after insert.
CREATE FUNCTION lead_purchases_financial_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW."leadId" IS DISTINCT FROM OLD."leadId"
        OR NEW."professionalProfileId" IS DISTINCT FROM OLD."professionalProfileId"
        OR NEW."price" IS DISTINCT FROM OLD."price"
        OR NEW."currency" IS DISTINCT FROM OLD."currency"
        OR NEW."pricingConfigVersion" IS DISTINCT FROM OLD."pricingConfigVersion"
        OR NEW."pricingRuleVersion" IS DISTINCT FROM OLD."pricingRuleVersion"
        OR NEW."leadPublishedAt" IS DISTINCT FROM OLD."leadPublishedAt"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
        -- tax/total are write-once: NULL -> value is allowed, a set value never changes.
        OR (OLD."taxAmount" IS NOT NULL AND NEW."taxAmount" IS DISTINCT FROM OLD."taxAmount")
        OR (OLD."totalAmount" IS NOT NULL AND NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount")
    THEN
        RAISE EXCEPTION 'Lead purchase financial snapshot is immutable (purchase %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_purchases_financial_immutable_trg
    BEFORE UPDATE ON "lead_purchases"
    FOR EACH ROW EXECUTE FUNCTION lead_purchases_financial_immutable();
