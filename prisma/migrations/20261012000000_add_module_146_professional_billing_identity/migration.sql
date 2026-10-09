-- Hand-authored (same caveat as prior migrations in this repo: the table/enum DDL mirrors what
-- Prisma generates; the CHECK constraints and trigger functions cannot be expressed in schema.prisma).
--
-- Module 146 — Professional Billing Identity.
--
-- Purely additive: two enums and ONE new table "professional_billing_identities". No existing table,
-- column, row, constraint or trigger is changed, and NO row is inserted or backfilled. Every existing
-- professional therefore has NO billing identity (= MISSING, not billing-ready). In particular nothing is
-- copied from "professional_profiles"."taxId"/"businessName" (self-entered and unreviewed) and nothing is
-- ever created as VERIFIED.
--
-- Invariants enforced in the database (independent of application code):
--   1. only UNVERIFIED / VERIFIED / REJECTED are used (the shared VerificationStatus enum's PENDING is not);
--   2. VERIFIED carries verifiedAt and reviewedAt; every other status has verifiedAt NULL;
--   3. a rejection reason exists exactly when status = REJECTED;
--   4. canonical shapes: ISO-3166 alpha-2 countries, normalised tax id, non-blank names;
--   5. a row cannot be INSERTed in any status other than UNVERIFIED;
--   6. changing ANY billing detail resets the row to UNVERIFIED, clears review metadata and bumps
--      "revision" — a stale VERIFIED can never survive an edit, even through raw SQL;
--   7. the owning professional profile cannot be changed.
-- Rollback: DROP TABLE "professional_billing_identities"; DROP FUNCTION professional_billing_identity_guard();
--           DROP FUNCTION professional_billing_identity_insert_guard(); DROP TYPE "BillingIdentityRejectionReason";
--           DROP TYPE "BillingEntityType";

-- CreateEnum
CREATE TYPE "BillingEntityType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "BillingIdentityRejectionReason" AS ENUM ('TAX_ID_MISMATCH', 'LEGAL_NAME_MISMATCH', 'ADDRESS_INVALID', 'OTHER');

-- CreateTable
CREATE TABLE "professional_billing_identities" (
    "id" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "entityType" "BillingEntityType" NOT NULL,
    "legalName" VARCHAR(200) NOT NULL,
    "taxId" VARCHAR(20) NOT NULL,
    "taxCountry" VARCHAR(2) NOT NULL,
    "addressLine1" VARCHAR(200) NOT NULL,
    "addressLine2" VARCHAR(200),
    "city" VARCHAR(120) NOT NULL,
    "region" VARCHAR(120),
    "postalCode" VARCHAR(20) NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "rejectionReason" "BillingIdentityRejectionReason",
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professional_billing_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "professional_billing_identities_professionalProfileId_key" ON "professional_billing_identities"("professionalProfileId");

-- CreateIndex
CREATE INDEX "prof_billing_identities_status_updated_idx" ON "professional_billing_identities"("verificationStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "professional_billing_identities_reviewedByUserId_idx" ON "professional_billing_identities"("reviewedByUserId");

-- AddForeignKey
ALTER TABLE "professional_billing_identities" ADD CONSTRAINT "professional_billing_identities_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_billing_identities" ADD CONSTRAINT "professional_billing_identities_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1. Only the three lifecycle statuses are used.
ALTER TABLE "professional_billing_identities" ADD CONSTRAINT "professional_billing_identities_status_allowed" CHECK (
    "verificationStatus" IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')
);

-- 2. VERIFIED has a verification and review timestamp; no other status keeps a verification timestamp.
ALTER TABLE "professional_billing_identities" ADD CONSTRAINT "professional_billing_identities_verified_metadata" CHECK (
    ("verificationStatus" = 'VERIFIED' AND "verifiedAt" IS NOT NULL AND "reviewedAt" IS NOT NULL)
    OR ("verificationStatus" <> 'VERIFIED' AND "verifiedAt" IS NULL)
);

-- 3. A rejection reason exists exactly for REJECTED rows.
ALTER TABLE "professional_billing_identities" ADD CONSTRAINT "professional_billing_identities_rejection_reason" CHECK (
    ("verificationStatus" = 'REJECTED') = ("rejectionReason" IS NOT NULL)
);

-- 4. Canonical shapes (syntax only — no per-country tax-id checksum, no registry lookup).
ALTER TABLE "professional_billing_identities" ADD CONSTRAINT "professional_billing_identities_shape" CHECK (
    "taxCountry" ~ '^[A-Z]{2}$'
    AND "country" ~ '^[A-Z]{2}$'
    AND "taxId" ~ '^[A-Z0-9]{4,20}$'
    AND btrim("legalName") <> ''
    AND btrim("addressLine1") <> ''
    AND btrim("city") <> ''
    AND btrim("postalCode") <> ''
    AND "revision" >= 1
);

-- 5. A billing identity can only ever be created UNVERIFIED.
CREATE OR REPLACE FUNCTION professional_billing_identity_insert_guard() RETURNS trigger AS $$
BEGIN
    IF NEW."verificationStatus" <> 'UNVERIFIED' THEN
        RAISE EXCEPTION 'A billing identity must be created UNVERIFIED (profile %)', NEW."professionalProfileId"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER professional_billing_identity_insert_guard
    BEFORE INSERT ON "professional_billing_identities"
    FOR EACH ROW EXECUTE FUNCTION professional_billing_identity_insert_guard();

-- 6 + 7. Material change invalidates verification; ownership is immutable.
CREATE OR REPLACE FUNCTION professional_billing_identity_guard() RETURNS trigger AS $$
BEGIN
    IF NEW."professionalProfileId" IS DISTINCT FROM OLD."professionalProfileId" THEN
        RAISE EXCEPTION 'Billing identity ownership is immutable (identity %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."entityType" IS DISTINCT FROM OLD."entityType"
        OR NEW."legalName" IS DISTINCT FROM OLD."legalName"
        OR NEW."taxId" IS DISTINCT FROM OLD."taxId"
        OR NEW."taxCountry" IS DISTINCT FROM OLD."taxCountry"
        OR NEW."addressLine1" IS DISTINCT FROM OLD."addressLine1"
        OR NEW."addressLine2" IS DISTINCT FROM OLD."addressLine2"
        OR NEW."city" IS DISTINCT FROM OLD."city"
        OR NEW."region" IS DISTINCT FROM OLD."region"
        OR NEW."postalCode" IS DISTINCT FROM OLD."postalCode"
        OR NEW."country" IS DISTINCT FROM OLD."country"
    THEN
        NEW."verificationStatus" := 'UNVERIFIED';
        NEW."verifiedAt" := NULL;
        NEW."reviewedAt" := NULL;
        NEW."reviewedByUserId" := NULL;
        NEW."rejectionReason" := NULL;
        NEW."reviewNote" := NULL;
        NEW."revision" := OLD."revision" + 1;
    ELSIF NEW."revision" IS DISTINCT FROM OLD."revision" THEN
        -- The revision only moves with a material change.
        RAISE EXCEPTION 'Billing identity revision can only change with its details (identity %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER professional_billing_identity_guard
    BEFORE UPDATE ON "professional_billing_identities"
    FOR EACH ROW EXECUTE FUNCTION professional_billing_identity_guard();
