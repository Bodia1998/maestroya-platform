-- Hand-authored (same caveat as prior migrations in this repo).
--
-- Module 133 — Lead publication contract: immutable price / buyer-policy
-- snapshot stored on the Lead row.
--
-- Additive: ten NULLABLE columns on "leads" plus CHECK constraints. No column
-- is dropped/renamed/rewritten, no data is updated, no other table is touched.
-- Existing rows keep every new column NULL (= "no publication snapshot").
-- LeadPurchase, ServiceRequest and every legacy financial table are untouched.
--
-- Invariants enforced by the database (the application enforces the same via
-- a single status-conditional UPDATE, PrismaLeadRepository.publish):
--   1. the snapshot is all-or-nothing (never half written);
--   2. the snapshot values are sane (price > 0, EUR, rate in (0,1], maxBuyers >= 1);
--   3. a lead cannot BECOME / BE written as PUBLISHED without a snapshot and
--      a buyer policy. This CHECK is NOT VALID on purpose: Module 124 leads
--      that were PUBLISHED before this module have no snapshot, and this
--      migration must not rewrite or reject them. PostgreSQL still enforces a
--      NOT VALID constraint for every new or updated row version. Such legacy
--      rows are simply not marketplace-ready (see isLeadMarketplaceReady);
--      what to do with them is an operational decision, not made here.
--   4. once published, the snapshot and maxBuyers can never change (trigger).
-- Rollback: DROP TRIGGER leads_publication_snapshot_immutable_trg ON "leads";
--           DROP FUNCTION leads_publication_snapshot_immutable();
--           ALTER TABLE "leads" DROP CONSTRAINT ... (3 checks), DROP COLUMN (10 columns).

-- AlterTable
ALTER TABLE "leads"
    ADD COLUMN "publishedAt" TIMESTAMP(3),
    ADD COLUMN "publicationPrice" DECIMAL(10,2),
    ADD COLUMN "publicationCurrency" TEXT,
    ADD COLUMN "publicationEstimatedJobValue" DECIMAL(10,2),
    ADD COLUMN "publicationPricingRate" DECIMAL(8,6),
    ADD COLUMN "publicationPricingConfidence" TEXT,
    ADD COLUMN "publicationPricingConfigVersion" TEXT,
    ADD COLUMN "publicationJobValueRuleVersion" TEXT,
    ADD COLUMN "publicationPricingRuleVersion" TEXT,
    ADD COLUMN "publicationBuyerPolicyVersion" TEXT;

-- The snapshot is written completely or not at all.
ALTER TABLE "leads" ADD CONSTRAINT "leads_publication_snapshot_all_or_nothing" CHECK (
    num_nonnulls(
        "publishedAt", "publicationPrice", "publicationCurrency", "publicationEstimatedJobValue",
        "publicationPricingRate", "publicationPricingConfidence", "publicationPricingConfigVersion",
        "publicationJobValueRuleVersion", "publicationPricingRuleVersion", "publicationBuyerPolicyVersion"
    ) IN (0, 10)
);

-- Sane snapshot values (a zero/negative price or foreign currency can never be offered).
ALTER TABLE "leads" ADD CONSTRAINT "leads_publication_snapshot_values_valid" CHECK (
    "publishedAt" IS NULL OR (
        "publicationPrice" > 0
        AND "publicationCurrency" = 'EUR'
        AND "publicationEstimatedJobValue" > 0
        AND "publicationPricingRate" > 0 AND "publicationPricingRate" <= 1
        AND "publicationPricingConfidence" IN ('LOW', 'MEDIUM', 'HIGH')
        AND "maxBuyers" IS NOT NULL
    )
);

-- A PUBLISHED lead always carries its snapshot (NOT VALID: legacy M124 rows are not rewritten).
ALTER TABLE "leads" ADD CONSTRAINT "leads_published_requires_snapshot" CHECK (
    "status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL
) NOT VALID;

-- Once a snapshot exists it can never be changed or removed.
CREATE FUNCTION leads_publication_snapshot_immutable() RETURNS trigger AS $$
BEGIN
    IF OLD."publishedAt" IS NOT NULL AND (
        NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
        OR NEW."publicationPrice" IS DISTINCT FROM OLD."publicationPrice"
        OR NEW."publicationCurrency" IS DISTINCT FROM OLD."publicationCurrency"
        OR NEW."publicationEstimatedJobValue" IS DISTINCT FROM OLD."publicationEstimatedJobValue"
        OR NEW."publicationPricingRate" IS DISTINCT FROM OLD."publicationPricingRate"
        OR NEW."publicationPricingConfidence" IS DISTINCT FROM OLD."publicationPricingConfidence"
        OR NEW."publicationPricingConfigVersion" IS DISTINCT FROM OLD."publicationPricingConfigVersion"
        OR NEW."publicationJobValueRuleVersion" IS DISTINCT FROM OLD."publicationJobValueRuleVersion"
        OR NEW."publicationPricingRuleVersion" IS DISTINCT FROM OLD."publicationPricingRuleVersion"
        OR NEW."publicationBuyerPolicyVersion" IS DISTINCT FROM OLD."publicationBuyerPolicyVersion"
        OR NEW."maxBuyers" IS DISTINCT FROM OLD."maxBuyers"
    ) THEN
        RAISE EXCEPTION 'Lead publication snapshot is immutable (lead %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_publication_snapshot_immutable_trg
    BEFORE UPDATE ON "leads"
    FOR EACH ROW EXECUTE FUNCTION leads_publication_snapshot_immutable();
