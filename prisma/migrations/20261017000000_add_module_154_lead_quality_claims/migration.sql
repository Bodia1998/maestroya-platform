-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints, triggers and SQL-only foreign keys cannot be expressed in schema.prisma).
--
-- Module 154 (Part A) — Lead Quality Claims Workflow. Purely ADDITIVE: two enums, one new table, its indexes, SQL-only
-- foreign keys, CHECK constraints and four triggers. No existing table, column, row, enum or trigger is altered, rewritten
-- or backfilled. In particular NOTHING of Module 153 (lead_fee_refunds, its enums, CHECKs or triggers), the purchase
-- financial-immutability trigger, the M149 ledger, M150 invoices or M151 credit notes is touched, and this table holds NO
-- reference to a refund, ledger entry, invoice or credit note: a claim decision is NOT a financial result.
--
-- One row = one claim by a professional about one CONFIRMED lead purchase. Guarantees encoded here:
--   1. ONE claim per purchase: UNIQUE ("leadPurchaseId");
--   2. the INSERT is cross-checked against the authoritative purchase: it must exist, be CONFIRMED, belong to the claiming
--      professional and be inside the claim window (submittedAt in [confirmedAt, confirmedAt + 72h]); submittedAt must also be
--      close to the database clock (+/- 5 minutes), so a client clock cannot widen the window;
--   3. respondBy = submittedAt + 72h (CHECK): a response TARGET, never an automatic decision;
--   4. anti-abuse, concurrency-safe: the INSERT trigger first takes a row lock on the professional's profile, so concurrent
--      claim inserts of ONE professional are serialized and each sees the previous one's row before counting. It rejects the
--      4th OPEN claim (SUBMITTED / UNDER_REVIEW) and the 11th claim submitted within a rolling 30 days;
--   5. status moves forward only (SUBMITTED -> UNDER_REVIEW | APPROVED | REJECTED; UNDER_REVIEW -> APPROVED | REJECTED);
--      APPROVED and REJECTED are terminal, so approval and rejection can never both happen;
--   6. who/what/why columns (purchase, professional, reason, description, evidence, submittedAt, respondBy) are immutable;
--      review-start and decision fields are write-once and required exactly when the status says so (CHECK);
--   7. rows are never deleted.
-- TRUNCATE is unaffected, as for the ledger / invoice / credit-note / refund tables.
--
-- Rollback (manual, only if no claim was ever recorded): DROP TABLE "lead_quality_claims";
--   DROP FUNCTION lead_quality_claims_validate_insert(); DROP FUNCTION lead_quality_claims_guard_update();
--   DROP FUNCTION lead_quality_claims_no_delete(); DROP TYPE "LeadQualityClaimStatus"; DROP TYPE "LeadQualityClaimReason";

-- CreateEnum
CREATE TYPE "LeadQualityClaimReason" AS ENUM ('CONTACT_UNREACHABLE', 'CONTACT_INVALID', 'DUPLICATE_LEAD');

-- CreateEnum
CREATE TYPE "LeadQualityClaimStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "lead_quality_claims" (
    "id" UUID NOT NULL,
    "leadPurchaseId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "reasonCode" "LeadQualityClaimReason" NOT NULL,
    "status" "LeadQualityClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "description" VARCHAR(1000) NOT NULL,
    "evidenceReference" VARCHAR(200),
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "respondBy" TIMESTAMP(3) NOT NULL,
    "reviewStartedAt" TIMESTAMP(3),
    "reviewStartedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "decisionExplanation" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_quality_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_quality_claims_leadPurchaseId_key" ON "lead_quality_claims"("leadPurchaseId");
CREATE INDEX "lead_quality_claims_professionalProfileId_status_idx" ON "lead_quality_claims"("professionalProfileId", "status");
CREATE INDEX "lead_quality_claims_professionalProfileId_submittedAt_idx" ON "lead_quality_claims"("professionalProfileId", "submittedAt");
CREATE INDEX "lead_quality_claims_status_respondBy_idx" ON "lead_quality_claims"("status", "respondBy");

-- SQL-only foreign keys (the Prisma model is scalar-only so that no existing model is modified).
ALTER TABLE "lead_quality_claims" ADD CONSTRAINT "lead_quality_claims_leadPurchaseId_fkey" FOREIGN KEY ("leadPurchaseId") REFERENCES "lead_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_quality_claims" ADD CONSTRAINT "lead_quality_claims_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_quality_claims" ADD CONSTRAINT "lead_quality_claims_reviewStartedByUserId_fkey" FOREIGN KEY ("reviewStartedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_quality_claims" ADD CONSTRAINT "lead_quality_claims_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Shape CHECKs (Prisma cannot express them).
ALTER TABLE "lead_quality_claims" ADD CONSTRAINT "lead_quality_claims_text_check"
    CHECK (
        length(btrim("description")) BETWEEN 10 AND 1000
        AND ("evidenceReference" IS NULL OR length(btrim("evidenceReference")) BETWEEN 1 AND 200)
        AND ("decisionExplanation" IS NULL OR length(btrim("decisionExplanation")) BETWEEN 1 AND 1000)
    );
ALTER TABLE "lead_quality_claims" ADD CONSTRAINT "lead_quality_claims_respond_by_check"
    CHECK ("respondBy" = "submittedAt" + INTERVAL '72 hours');
ALTER TABLE "lead_quality_claims" ADD CONSTRAINT "lead_quality_claims_status_fields_check"
    CHECK (
        ("status" = 'SUBMITTED'
            AND "reviewStartedAt" IS NULL AND "reviewStartedByUserId" IS NULL
            AND "decidedAt" IS NULL AND "decidedByUserId" IS NULL AND "decisionExplanation" IS NULL)
        OR ("status" = 'UNDER_REVIEW'
            AND "reviewStartedAt" IS NOT NULL AND "reviewStartedByUserId" IS NOT NULL
            AND "decidedAt" IS NULL AND "decidedByUserId" IS NULL AND "decisionExplanation" IS NULL)
        OR ("status" IN ('APPROVED', 'REJECTED')
            AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decisionExplanation" IS NOT NULL
            AND (("reviewStartedAt" IS NULL) = ("reviewStartedByUserId" IS NULL)))
    );

-- INSERT guard: a new claim starts bare SUBMITTED and is cross-checked against the authoritative purchase; the per-professional
-- limits are checked while holding a row lock on the professional's profile (serializes concurrent claims of ONE professional).
CREATE OR REPLACE FUNCTION lead_quality_claims_validate_insert() RETURNS trigger AS $$
DECLARE
    pur RECORD;
    open_claims INTEGER;
    recent_claims INTEGER;
BEGIN
    IF NEW."status" <> 'SUBMITTED' OR NEW."reviewStartedAt" IS NOT NULL OR NEW."reviewStartedByUserId" IS NOT NULL
       OR NEW."decidedAt" IS NOT NULL OR NEW."decidedByUserId" IS NOT NULL OR NEW."decisionExplanation" IS NOT NULL THEN
        RAISE EXCEPTION 'lead_quality_claims must be inserted as a bare SUBMITTED row'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Serialize every claim insert of this professional (a concurrent insert waits here, then sees our committed row).
    PERFORM 1 FROM "professional_profiles" WHERE "id" = NEW."professionalProfileId" FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lead_quality_claims requires an existing professional profile'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO pur FROM "lead_purchases" WHERE "id" = NEW."leadPurchaseId" FOR SHARE;
    IF NOT FOUND
       OR pur."status" <> 'CONFIRMED'
       OR pur."confirmedAt" IS NULL
       OR pur."professionalProfileId" IS DISTINCT FROM NEW."professionalProfileId" THEN
        RAISE EXCEPTION 'lead_quality_claims claim is not for a CONFIRMED purchase of this professional'
            USING ERRCODE = 'check_violation';
    END IF;

    IF abs(extract(epoch FROM (NEW."submittedAt" - (clock_timestamp() AT TIME ZONE 'UTC')))) > 300 THEN
        RAISE EXCEPTION 'lead_quality_claims submittedAt is not close to the database clock'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."submittedAt" < pur."confirmedAt" OR NEW."submittedAt" > pur."confirmedAt" + INTERVAL '72 hours' THEN
        RAISE EXCEPTION 'lead_quality_claims claim window (72 hours after confirmation) has passed'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO open_claims FROM "lead_quality_claims"
        WHERE "professionalProfileId" = NEW."professionalProfileId" AND "status" IN ('SUBMITTED', 'UNDER_REVIEW');
    IF open_claims >= 3 THEN
        RAISE EXCEPTION 'lead_quality_claims open claim limit (3) reached'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO recent_claims FROM "lead_quality_claims"
        WHERE "professionalProfileId" = NEW."professionalProfileId"
          AND "submittedAt" > NEW."submittedAt" - INTERVAL '30 days';
    IF recent_claims >= 10 THEN
        RAISE EXCEPTION 'lead_quality_claims period claim limit (10 per 30 days) reached'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_quality_claims_validate_insert_trg
    BEFORE INSERT ON "lead_quality_claims"
    FOR EACH ROW EXECUTE FUNCTION lead_quality_claims_validate_insert();

-- UPDATE guard: immutable identity/content, write-once review & decision fields, forward-only status.
CREATE OR REPLACE FUNCTION lead_quality_claims_guard_update() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."leadPurchaseId" IS DISTINCT FROM OLD."leadPurchaseId"
       OR NEW."professionalProfileId" IS DISTINCT FROM OLD."professionalProfileId"
       OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
       OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
       OR NEW."respondBy" IS DISTINCT FROM OLD."respondBy"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'lead_quality_claims identity / content columns are immutable (claim %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF (OLD."reviewStartedAt" IS NOT NULL AND NEW."reviewStartedAt" IS DISTINCT FROM OLD."reviewStartedAt")
       OR (OLD."reviewStartedByUserId" IS NOT NULL AND NEW."reviewStartedByUserId" IS DISTINCT FROM OLD."reviewStartedByUserId")
       OR (OLD."decidedAt" IS NOT NULL AND NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt")
       OR (OLD."decidedByUserId" IS NOT NULL AND NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId")
       OR (OLD."decisionExplanation" IS NOT NULL AND NEW."decisionExplanation" IS DISTINCT FROM OLD."decisionExplanation") THEN
        RAISE EXCEPTION 'lead_quality_claims review / decision fields are write-once (claim %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."status" <> OLD."status" AND NOT (
           (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED'))
        OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('APPROVED', 'REJECTED'))
    ) THEN
        RAISE EXCEPTION 'lead_quality_claims illegal status transition % -> % (claim %)', OLD."status", NEW."status", OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_quality_claims_guard_update_trg
    BEFORE UPDATE ON "lead_quality_claims"
    FOR EACH ROW EXECUTE FUNCTION lead_quality_claims_guard_update();

-- DELETE is never allowed: claim history is preserved.
CREATE OR REPLACE FUNCTION lead_quality_claims_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_quality_claims is never deleted from (claim %)', OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_quality_claims_no_delete_trg
    BEFORE DELETE ON "lead_quality_claims"
    FOR EACH ROW EXECUTE FUNCTION lead_quality_claims_no_delete();
