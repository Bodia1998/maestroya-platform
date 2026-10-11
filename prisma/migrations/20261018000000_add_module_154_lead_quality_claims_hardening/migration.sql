-- Module 154 (Part A) hardening — follow-up to 20261017000000_add_module_154_lead_quality_claims.
--
-- ADDITIVE and re-runnable: only CREATE OR REPLACE of one new helper and two functions of that earlier migration. No table, column,
-- enum, index or trigger is created, altered or dropped, and no row is read or rewritten. M153 and every other table are untouched.
--
--   M1  The claim window is decided against the DATABASE clock. The insert trigger now OVERWRITES `submittedAt` with the database
--       clock (millisecond precision, UTC) and `respondBy` with `submittedAt + 72 hours`, whatever the client sent, and decides the
--       72-hour window against that same instant. The previous "submittedAt within 5 minutes of the database clock" guard is gone
--       (it let a client-chosen timestamp widen the window by up to 5 minutes); the existing respond_by_check CHECK still holds.
--       Boundary semantics (unchanged): INCLUSIVE at both ends, i.e. a claim at exactly confirmedAt + 72 hours is ACCEPTED, one
--       millisecond later is rejected, and one before confirmedAt is rejected. The rule lives in lead_quality_claims_window_open().
--   M2  Separation of duties backstop: the update guard refuses to record a review-start or decision whose actor is the user that
--       owns the claim's professional profile. (The use cases check this first and answer with the generic authorization error.)
--
-- Rollback (manual, only while no claim depends on the new behaviour): re-apply the function bodies of
-- 20261017000000_add_module_154_lead_quality_claims with CREATE OR REPLACE, then DROP FUNCTION lead_quality_claims_window_open(timestamp, timestamp).

-- The single definition of "the claim window is open": inclusive on both ends, never before the confirmation.
CREATE OR REPLACE FUNCTION lead_quality_claims_window_open(confirmed_at TIMESTAMP, submitted_at TIMESTAMP) RETURNS boolean AS $$
    SELECT submitted_at >= confirmed_at AND submitted_at <= confirmed_at + INTERVAL '72 hours';
$$ LANGUAGE sql IMMUTABLE;

-- INSERT guard: bare SUBMITTED row, cross-checked against the authoritative purchase, stamped with the database clock, limits checked
-- while holding a row lock on the professional's profile (serializes concurrent claims of ONE professional).
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

    -- M1: the database clock is the ONLY time source. Taken after the locks above, so a wait for them never makes the stamp stale.
    NEW."submittedAt" := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
    NEW."respondBy" := NEW."submittedAt" + INTERVAL '72 hours';

    IF NOT lead_quality_claims_window_open(pur."confirmedAt", NEW."submittedAt") THEN
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

-- UPDATE guard: immutable identity/content, write-once review & decision fields, forward-only status, and (M2) no self-review.
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

    -- M2: the user who owns the claim's professional profile can never be the one who starts its review or decides it.
    IF (NEW."reviewStartedByUserId" IS NOT NULL AND NEW."reviewStartedByUserId" IS DISTINCT FROM OLD."reviewStartedByUserId"
        AND EXISTS (SELECT 1 FROM "professional_profiles" WHERE "id" = OLD."professionalProfileId" AND "userId" = NEW."reviewStartedByUserId"))
       OR (NEW."decidedByUserId" IS NOT NULL AND NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId"
        AND EXISTS (SELECT 1 FROM "professional_profiles" WHERE "id" = OLD."professionalProfileId" AND "userId" = NEW."decidedByUserId")) THEN
        RAISE EXCEPTION 'lead_quality_claims separation of duties: the claim owner cannot review or decide it (claim %)', OLD."id"
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
