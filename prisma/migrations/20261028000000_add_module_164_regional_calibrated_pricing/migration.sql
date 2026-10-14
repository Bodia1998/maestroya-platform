-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints, triggers and SQL-only foreign keys cannot be expressed in schema.prisma).
--
-- Module 164 — Regional & Calibrated Pricing. Purely ADDITIVE:
--   * one NULLABLE column on "leads" (publicationCalibrationProvenance JSONB) + its CHECKs;
--   * two enums, two new tables ("lead_pricing_reviews", "lead_estimate_outcomes"), their indexes, SQL-only foreign keys,
--     CHECK constraints and triggers.
-- No existing column is dropped/renamed/rewritten and NO row is updated: every existing lead keeps the new column NULL (= "priced
-- by the Module 132/163 pipeline"), so nothing already published or purchased is re-priced. lead_purchases and every financial,
-- ledger, invoice, credit-note, refund and legacy table are untouched.
--
-- M133 / M163 compatibility. The ten M133 publication columns stay an all-or-nothing group guarded by
-- "leads_publication_snapshot_all_or_nothing" (NOT modified) and the new column is NOT part of it. The only existing object
-- touched is the immutability trigger FUNCTION leads_publication_snapshot_immutable(): replaced (same name, same trigger) so the
-- calibration provenance is immutable once published exactly like the rest of the snapshot. The replacement is the M163 body plus
-- one condition; nothing is removed.
--
-- Rollback (manual, only if no review/outcome/provenance was ever recorded): DROP TABLE "lead_pricing_reviews";
--   DROP TABLE "lead_estimate_outcomes"; DROP FUNCTION lead_pricing_reviews_guard_update(); DROP FUNCTION
--   lead_estimate_outcomes_immutable(); DROP TYPE "LeadPricingReviewStatus"; DROP TYPE "LeadEstimateOutcomeSource";
--   ALTER TABLE "leads" DROP CONSTRAINT leads_publication_calibration_valid, DROP COLUMN "publicationCalibrationProvenance";
--   then re-run the M163 definition of leads_publication_snapshot_immutable().

-- ---------------------------------------------------------------------------
-- leads: calibration provenance of the published price
-- ---------------------------------------------------------------------------
ALTER TABLE "leads" ADD COLUMN "publicationCalibrationProvenance" JSONB;

-- NULL, or a JSON object on a published lead (never on a draft).
ALTER TABLE "leads" ADD CONSTRAINT "leads_publication_calibration_valid" CHECK (
    "publicationCalibrationProvenance" IS NULL OR (
        "publishedAt" IS NOT NULL
        AND jsonb_typeof("publicationCalibrationProvenance") = 'object'
        AND "publicationCalibrationProvenance" <> '{}'::jsonb
    )
);

-- Once a snapshot exists it can never be changed or removed — now including the calibration provenance.
CREATE OR REPLACE FUNCTION leads_publication_snapshot_immutable() RETURNS trigger AS $$
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
        OR NEW."publicationScopeQuestionnaireVersion" IS DISTINCT FROM OLD."publicationScopeQuestionnaireVersion"
        OR NEW."publicationScopeAnswers" IS DISTINCT FROM OLD."publicationScopeAnswers"
        OR NEW."publicationCalibrationProvenance" IS DISTINCT FROM OLD."publicationCalibrationProvenance"
        OR NEW."maxBuyers" IS DISTINCT FROM OLD."maxBuyers"
    ) THEN
        RAISE EXCEPTION 'Lead publication snapshot is immutable (lead %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- lead_pricing_reviews
-- ---------------------------------------------------------------------------
-- CreateEnum
CREATE TYPE "LeadPricingReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "lead_pricing_reviews" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "status" "LeadPricingReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reasonCodes" TEXT[],
    "categorySlug" TEXT NOT NULL,
    "parentCategorySlug" TEXT,
    "provinceCode" TEXT NOT NULL,
    "calibrationVersion" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "reviewedJobValue" DECIMAL(10,2),
    "decisionNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pricing_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_pricing_reviews_leadId_inputFingerprint_key" ON "lead_pricing_reviews"("leadId", "inputFingerprint");
CREATE INDEX "lead_pricing_reviews_status_createdAt_idx" ON "lead_pricing_reviews"("status", "createdAt");
CREATE INDEX "lead_pricing_reviews_leadId_idx" ON "lead_pricing_reviews"("leadId");

-- At most ONE pending review per lead (Prisma cannot express partial indexes; same precedent as lead_purchases).
CREATE UNIQUE INDEX "lead_pricing_reviews_one_pending_per_lead" ON "lead_pricing_reviews"("leadId") WHERE "status" = 'PENDING_REVIEW';

-- SQL-only foreign keys (the Prisma models are scalar-only so that no existing model is modified).
ALTER TABLE "lead_pricing_reviews" ADD CONSTRAINT "lead_pricing_reviews_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_pricing_reviews" ADD CONSTRAINT "lead_pricing_reviews_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Shape CHECKs.
ALTER TABLE "lead_pricing_reviews" ADD CONSTRAINT "lead_pricing_reviews_shape_check" CHECK (
    "inputFingerprint" ~ '^[0-9a-f]{64}$'
    AND cardinality("reasonCodes") >= 1
    AND "reasonCodes" <@ ARRAY['CALIBRATION_MISSING', 'CALIBRATION_PENDING_EVIDENCE', 'CONFIDENCE_BELOW_THRESHOLD', 'CONFLICTING_ANSWERS']::text[]
    AND "calibrationVersion" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    AND jsonb_typeof("provenance") = 'object'
    AND ("decisionNote" IS NULL OR length(btrim("decisionNote")) BETWEEN 1 AND 1000)
);

-- Decision D1 at the database level: a review exists only for paid-lead territory (province codes 01..52 except Canarias 35/38,
-- Ceuta 51 and Melilla 52).
ALTER TABLE "lead_pricing_reviews" ADD CONSTRAINT "lead_pricing_reviews_territory_check" CHECK (
    "provinceCode" ~ '^(0[1-9]|[1-4][0-9]|5[0-2])$'
    AND "provinceCode" NOT IN ('35', '38', '51', '52')
);

-- The fields a status requires, exactly.
ALTER TABLE "lead_pricing_reviews" ADD CONSTRAINT "lead_pricing_reviews_status_fields_check" CHECK (
    (
        "status" = 'PENDING_REVIEW'
        AND "decidedAt" IS NULL AND "decidedByUserId" IS NULL AND "reviewedJobValue" IS NULL AND "decisionNote" IS NULL
    ) OR (
        "status" = 'APPROVED'
        AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "reviewedJobValue" IS NOT NULL AND "reviewedJobValue" > 0
    ) OR (
        "status" = 'REJECTED'
        AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "reviewedJobValue" IS NULL
    ) OR (
        "status" = 'SUPERSEDED'
        AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NULL AND "reviewedJobValue" IS NULL AND "decisionNote" IS NULL
    )
);

-- Identity and content are immutable; only a pending review can move, and a decided one is final.
CREATE OR REPLACE FUNCTION lead_pricing_reviews_guard_update() RETURNS trigger AS $$
BEGIN
    IF NEW."leadId" IS DISTINCT FROM OLD."leadId"
        OR NEW."inputFingerprint" IS DISTINCT FROM OLD."inputFingerprint"
        OR NEW."reasonCodes" IS DISTINCT FROM OLD."reasonCodes"
        OR NEW."categorySlug" IS DISTINCT FROM OLD."categorySlug"
        OR NEW."parentCategorySlug" IS DISTINCT FROM OLD."parentCategorySlug"
        OR NEW."provinceCode" IS DISTINCT FROM OLD."provinceCode"
        OR NEW."calibrationVersion" IS DISTINCT FROM OLD."calibrationVersion"
        OR NEW."provenance" IS DISTINCT FROM OLD."provenance"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
        RAISE EXCEPTION 'Lead pricing review identity is immutable (review %)', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" <> 'PENDING_REVIEW' AND (
        NEW."status" IS DISTINCT FROM OLD."status"
        OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
        OR NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId"
        OR NEW."reviewedJobValue" IS DISTINCT FROM OLD."reviewedJobValue"
        OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote"
    ) THEN
        RAISE EXCEPTION 'A decided lead pricing review is final (review %)', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_pricing_reviews_guard_update_trigger
    BEFORE UPDATE ON "lead_pricing_reviews"
    FOR EACH ROW EXECUTE FUNCTION lead_pricing_reviews_guard_update();

-- ---------------------------------------------------------------------------
-- lead_estimate_outcomes
-- ---------------------------------------------------------------------------
-- CreateEnum
CREATE TYPE "LeadEstimateOutcomeSource" AS ENUM ('ADMIN_RECORDED', 'CUSTOMER_REPORTED', 'PROFESSIONAL_REPORTED');

-- CreateTable
CREATE TABLE "lead_estimate_outcomes" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "actualJobValue" DECIMAL(10,2) NOT NULL,
    "source" "LeadEstimateOutcomeSource" NOT NULL,
    "recordedByUserId" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_estimate_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_estimate_outcomes_leadId_key" ON "lead_estimate_outcomes"("leadId");
CREATE INDEX "lead_estimate_outcomes_recordedAt_idx" ON "lead_estimate_outcomes"("recordedAt");

ALTER TABLE "lead_estimate_outcomes" ADD CONSTRAINT "lead_estimate_outcomes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_estimate_outcomes" ADD CONSTRAINT "lead_estimate_outcomes_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_estimate_outcomes" ADD CONSTRAINT "lead_estimate_outcomes_value_check" CHECK (
    "actualJobValue" > 0
    AND ("note" IS NULL OR length(btrim("note")) BETWEEN 1 AND 500)
    -- A person recorded it: an admin/customer/professional source names the person.
    AND "recordedByUserId" IS NOT NULL
);

-- An outcome is evidence: once recorded it is never changed.
CREATE OR REPLACE FUNCTION lead_estimate_outcomes_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'A recorded lead estimate outcome is immutable (outcome %)', OLD."id" USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_estimate_outcomes_immutable_trigger
    BEFORE UPDATE OR DELETE ON "lead_estimate_outcomes"
    FOR EACH ROW EXECUTE FUNCTION lead_estimate_outcomes_immutable();
