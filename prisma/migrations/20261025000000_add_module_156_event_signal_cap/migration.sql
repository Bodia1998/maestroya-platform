-- Module 156 — persistence-level cap on stored raw EVENT signals (corrective, ADDITIVE: earlier M156 migrations are not edited).
--
-- Problem (audit M1): the raw event row is deduplicated per (type, subject, lead, hour), so a logged-in user who submits random lead
-- UUIDs creates one undeletable append-only row per UUID. 300 random ids produced 300 rows.
--
-- Control: a BEFORE INSERT trigger on "lead_abuse_signals", for the two EVENT signal types only, limits how many rows a subject
-- may have PER EVENT TYPE inside the trailing hour (50) and the trailing day (200), measured on the database clock. An insert over
-- the cap is SKIPPED (the trigger returns NULL): nothing is raised, nothing is stored, and the application's createMany(skipDuplicates)
-- simply reports "0 rows stored". The check and the insert are serialised per (subject, type) with a transaction-scoped advisory
-- lock, so concurrent writers cannot overshoot the cap. Rule-hit signals are not capped (their dedupe key already bounds them to one
-- row per rule and window). Both caps sit far above every default event-rule threshold (5 and 10 distinct leads per hour).
--
-- This only restricts INSERT. The append-only guarantee (no UPDATE, no DELETE) is untouched and no cleanup / retention is introduced
-- (M158 owns retention). Total growth is therefore bounded per unit of time (<= 200 rows per subject and event type per day), not
-- in total.
--
-- The numbers below MUST match LEAD_ABUSE_EVENT_CAP_PER_HOUR / _PER_DAY in src/core/domain/services/lead-abuse-controls.ts
-- (a static test compares them). Changing a cap requires a new additive migration (CREATE OR REPLACE FUNCTION).
--
-- Rollback (manual): DROP TRIGGER lead_abuse_signals_event_cap_trg ON "lead_abuse_signals"; DROP FUNCTION lead_abuse_signals_event_cap();

CREATE OR REPLACE FUNCTION lead_abuse_signals_event_cap() RETURNS trigger AS $$
DECLARE
    hourly_cap CONSTANT integer := 50;
    daily_cap  CONSTANT integer := 200;
    utc_now    timestamp(3);
    in_hour    integer;
    in_day     integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('lead_abuse_event_cap:' || NEW."subjectUserId"::text || ':' || NEW."signalType"::text, 0));

    -- Prisma stores "timestamp without time zone" as UTC; compare on the same basis whatever the session TimeZone is.
    utc_now := (now() AT TIME ZONE 'UTC');

    SELECT count(*) FILTER (WHERE s."occurredAt" > utc_now - INTERVAL '1 hour'), count(*)
      INTO in_hour, in_day
      FROM "lead_abuse_signals" s
     WHERE s."subjectUserId" = NEW."subjectUserId"
       AND s."signalType" = NEW."signalType"
       AND s."occurredAt" > utc_now - INTERVAL '1 day';

    IF in_hour >= hourly_cap OR in_day >= daily_cap THEN
        RETURN NULL; -- skip this row silently
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_abuse_signals_event_cap_trg
    BEFORE INSERT ON "lead_abuse_signals"
    FOR EACH ROW
    WHEN (NEW."signalType" IN ('PURCHASE_REJECTED_EVENT', 'CONTACT_ACCESS_DENIED_EVENT'))
    EXECUTE FUNCTION lead_abuse_signals_event_cap();
