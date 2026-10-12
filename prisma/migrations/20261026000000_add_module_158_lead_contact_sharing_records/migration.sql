-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints, triggers and SQL-only foreign keys cannot be expressed in schema.prisma).
--
-- Module 158 — GDPR / consent evidence for LEAD_V1. Purely ADDITIVE: one enum, one new table, its index, SQL-only foreign keys,
-- CHECK constraints, three triggers, and the Module 33 / 156 RLS + REVOKE hardening for the new table. No existing table, column,
-- row, enum or trigger is altered, rewritten or backfilled. In particular NO row is created for existing leads: a lead created
-- before this module has NO record, i.e. nobody is silently converted into a consenting customer.
--
-- One row = the customer's contact-sharing choice / notice for one lead (purpose LEAD_CONTACT_SHARING). Guarantees:
--   1. ONE row per lead: UNIQUE ("leadId");
--   2. the INSERT is cross-checked: the lead must exist and "userId" must be the customer user that owns the lead's service request,
--      and a row is never inserted already withdrawn;
--   3. identity / evidence columns (leadId, userId, basis, noticeVersion, recordedAt) are immutable;
--   4. "withdrawnAt" is write-once (NULL -> value), only for basis CONSENT (a notice is not a consent), and not before "recordedAt";
--   5. rows are never deleted (the evidence of a choice must survive; it holds no contact data, only ids, a basis, a version and times).
-- TRUNCATE is unaffected, as for the other lead tables.
--
-- Rollback (manual, only if no record was ever written): DROP TABLE "lead_contact_sharing_records";
--   DROP FUNCTION lead_contact_sharing_validate_insert(); DROP FUNCTION lead_contact_sharing_guard_update();
--   DROP FUNCTION lead_contact_sharing_no_delete(); DROP TYPE "LeadContactSharingBasis";

-- CreateEnum
CREATE TYPE "LeadContactSharingBasis" AS ENUM ('CONSENT', 'OTHER_LAWFUL_BASIS');

-- CreateTable
CREATE TABLE "lead_contact_sharing_records" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "basis" "LeadContactSharingBasis" NOT NULL,
    "noticeVersion" VARCHAR(64) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_contact_sharing_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_contact_sharing_records_leadId_key" ON "lead_contact_sharing_records"("leadId");

-- CreateIndex
CREATE INDEX "lead_contact_sharing_records_userId_idx" ON "lead_contact_sharing_records"("userId");

-- AddForeignKey (SQL only; history is never cascaded away)
ALTER TABLE "lead_contact_sharing_records" ADD CONSTRAINT "lead_contact_sharing_records_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_contact_sharing_records" ADD CONSTRAINT "lead_contact_sharing_records_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs
ALTER TABLE "lead_contact_sharing_records" ADD CONSTRAINT "lead_contact_sharing_records_notice_version_chk"
    CHECK (char_length(btrim("noticeVersion")) >= 1);

ALTER TABLE "lead_contact_sharing_records" ADD CONSTRAINT "lead_contact_sharing_records_withdrawn_only_consent_chk"
    CHECK ("withdrawnAt" IS NULL OR "basis" = 'CONSENT');

ALTER TABLE "lead_contact_sharing_records" ADD CONSTRAINT "lead_contact_sharing_records_withdrawn_after_recorded_chk"
    CHECK ("withdrawnAt" IS NULL OR "withdrawnAt" >= "recordedAt");

-- INSERT: the row must be for the lead's own customer and must not be born withdrawn.
CREATE FUNCTION lead_contact_sharing_validate_insert() RETURNS trigger AS $$
DECLARE
    owner_user UUID;
BEGIN
    IF NEW."withdrawnAt" IS NOT NULL THEN
        RAISE EXCEPTION 'lead_contact_sharing_records must be inserted without a withdrawal'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT cp."userId" INTO owner_user
      FROM "leads" l
      JOIN "service_requests" sr ON sr."id" = l."serviceRequestId"
      JOIN "customer_profiles" cp ON cp."id" = sr."customerId"
     WHERE l."id" = NEW."leadId";

    IF owner_user IS NULL OR owner_user <> NEW."userId" THEN
        RAISE EXCEPTION 'lead_contact_sharing_records user is not the customer of this lead'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_contact_sharing_validate_insert_trg
    BEFORE INSERT ON "lead_contact_sharing_records"
    FOR EACH ROW EXECUTE FUNCTION lead_contact_sharing_validate_insert();

-- UPDATE: evidence is immutable; only the one-way NULL -> value withdrawal is allowed.
CREATE FUNCTION lead_contact_sharing_guard_update() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."leadId" IS DISTINCT FROM OLD."leadId"
       OR NEW."userId" IS DISTINCT FROM OLD."userId"
       OR NEW."basis" IS DISTINCT FROM OLD."basis"
       OR NEW."noticeVersion" IS DISTINCT FROM OLD."noticeVersion"
       OR NEW."recordedAt" IS DISTINCT FROM OLD."recordedAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'lead_contact_sharing_records evidence columns are immutable'
            USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."withdrawnAt" IS NOT NULL AND NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt" THEN
        RAISE EXCEPTION 'lead_contact_sharing_records withdrawal is write-once'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_contact_sharing_guard_update_trg
    BEFORE UPDATE ON "lead_contact_sharing_records"
    FOR EACH ROW EXECUTE FUNCTION lead_contact_sharing_guard_update();

-- DELETE: never.
CREATE FUNCTION lead_contact_sharing_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_contact_sharing_records rows are never deleted'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_contact_sharing_no_delete_trg
    BEFORE DELETE ON "lead_contact_sharing_records"
    FOR EACH ROW EXECUTE FUNCTION lead_contact_sharing_no_delete();

-- Hardening (Module 33 checklist, same shape as the Module 156 permission-hardening migration): RLS with no policies = default deny
-- for non-owner roles (the application connects as the owner, which bypasses RLS; FORCE is deliberately NOT used), and no grants to
-- PUBLIC / the Supabase PostgREST roles where they exist.
ALTER TABLE "public"."lead_contact_sharing_records" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."lead_contact_sharing_records" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "public"."lead_contact_sharing_records" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "public"."lead_contact_sharing_records" FROM authenticated';
  END IF;
END
$$;
