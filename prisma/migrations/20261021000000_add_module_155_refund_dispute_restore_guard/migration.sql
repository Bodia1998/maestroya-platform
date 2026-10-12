-- Hand-authored. Module 155 — H1 fix (refund / dispute restore guard), part 3 of 3. ADDITIVE: it replaces ONE trigger function body
-- (CREATE OR REPLACE) and touches no table, column, index, enum or row. Modules 153 and 154 are not modified.
--
-- Defect fixed: a DISPUTED purchase could return to CONFIRMED (restoring contact access) after a Module 153 PLATFORM_ERROR refund had
-- SUCCEEDED, or while such a refund was still in flight / of uncertain outcome. "lead_purchases_dispute_guard" only looked at disputes.
--
-- New rule (everything else is byte-for-byte the previous function): DISPUTED -> CONFIRMED is refused while ANY PLATFORM_ERROR refund
-- attempt of the purchase is REQUESTED, PROVIDER_PENDING, UNKNOWN or SUCCEEDED. A FAILED attempt (the refund did not happen) does not
-- block. DISPUTED -> REFUNDED stays legal: the application converges a won / warning-closed dispute with a SUCCEEDED refund to REFUNDED.
-- Concurrency: this trigger runs inside the transaction that already holds the purchase row lock (the M155 repository locks it FOR
-- UPDATE first), and Module 153's refund INSERT trigger takes FOR SHARE on the same row, so a new refund attempt cannot appear between
-- the check and the commit. Refund statuses only move towards SUCCEEDED / FAILED, so a concurrent status change cannot invalidate a block.
--
-- Rollback (safe at any time; it only removes the extra rule):
--   re-run the CREATE OR REPLACE FUNCTION lead_purchases_dispute_guard() of migration 20261020000000_add_module_155_lead_fee_disputes.

CREATE OR REPLACE FUNCTION lead_purchases_dispute_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" = 'DISPUTED' THEN
            RAISE EXCEPTION 'a lead purchase cannot be created as DISPUTED'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
        RETURN NEW;
    END IF;

    IF NEW."status" = 'DISPUTED' THEN
        IF OLD."status" <> 'CONFIRMED' THEN
            RAISE EXCEPTION 'a lead purchase can only become DISPUTED from CONFIRMED (purchase %, was %)', OLD."id", OLD."status"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM "lead_fee_disputes"
            WHERE "leadPurchaseId" = NEW."id" AND "status" IN ('NEEDS_RESPONSE', 'UNDER_REVIEW')
        ) THEN
            RAISE EXCEPTION 'a lead purchase can only become DISPUTED while an open dispute is recorded (purchase %)', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF OLD."status" = 'DISPUTED' THEN
        IF NEW."status" NOT IN ('CONFIRMED', 'REFUNDED', 'REVOKED') THEN
            RAISE EXCEPTION 'a DISPUTED lead purchase can only become CONFIRMED, REFUNDED or REVOKED (purchase %, to %)', OLD."id", NEW."status"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" = 'CONFIRMED' AND EXISTS (
            SELECT 1 FROM "lead_fee_disputes"
            WHERE "leadPurchaseId" = NEW."id" AND "status" IN ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'LOST')
        ) THEN
            RAISE EXCEPTION 'a DISPUTED lead purchase cannot return to CONFIRMED while a dispute is open or lost (purchase %)', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        -- Module 155 H1: never restore access while a platform-error refund succeeded or may still succeed.
        IF NEW."status" = 'CONFIRMED' AND EXISTS (
            SELECT 1 FROM "lead_fee_refunds"
            WHERE "leadPurchaseId" = NEW."id" AND "reasonCode" = 'PLATFORM_ERROR'
              AND "status" IN ('REQUESTED', 'PROVIDER_PENDING', 'UNKNOWN', 'SUCCEEDED')
        ) THEN
            RAISE EXCEPTION 'a DISPUTED lead purchase cannot return to CONFIRMED while a platform-error refund is in flight or succeeded (purchase %)', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
