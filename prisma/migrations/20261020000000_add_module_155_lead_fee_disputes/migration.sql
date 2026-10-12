-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints, partial indexes and triggers cannot be expressed in schema.prisma).
--
-- Module 155 — Chargebacks & Access Revocation, part 2 of 2 (part 1 added the enum value DISPUTED).
--
-- ADDITIVE except for ONE deliberate replacement of an existing index (see 1.). No row is rewritten, backfilled or deleted.
-- The M135/M136/M140 purchase financial-immutability trigger, the M149 ledger, the M150 invoices, the M151 credit notes, the
-- M153 refunds and the M154 claims are NOT touched (the Prisma relation fields added to LeadPurchase have no database column).
--
--   1. "lead_purchases_one_active_per_lead_professional" is replaced by the same index whose predicate ALSO covers 'DISPUTED'.
--      A disputed purchase can come back to CONFIRMED (dispute won), so while it is disputed the professional must not be able
--      to buy the same lead again (the restore would otherwise violate uniqueness), exactly like PENDING_PAYMENT / CONFIRMED.
--      Existing rows are unaffected (none is DISPUTED), so the new index builds without conflict. The brief DROP/CREATE runs
--      inside this migration's transaction.
--   2. "lead_fee_disputes": one row per provider dispute (UNIQUE providerDisputeId = the idempotency key of the dispute itself).
--      The insert trigger cross-checks the payment reference, currency and amount against the purchase's persisted snapshot.
--      Money / identity columns are immutable, status moves forward only (NEEDS_RESPONSE -> UNDER_REVIEW -> WON | LOST |
--      WARNING_CLOSED; the three terminal statuses are absorbing), closedAt is set exactly when a terminal status is reached,
--      evidence submission moves NOT_SUBMITTED -> SUBMISSION_PENDING -> SUBMITTED (or back to NOT_SUBMITTED after a definitive
--      provider rejection) and only while the dispute NEEDS_RESPONSE. Rows are never deleted.
--   3. "lead_purchases_dispute_guard": a purchase can only become DISPUTED from CONFIRMED and only while an OPEN dispute is
--      recorded for it; a DISPUTED purchase can only return to CONFIRMED when NO dispute is open and none was LOST; DISPUTED can
--      only leave towards CONFIRMED / REFUNDED / REVOKED; a purchase cannot be INSERTED as DISPUTED.
--   4. "lead_purchase_revocations": append-only record of why a purchase is REVOKED (ADMIN: actor + explanation + evidence
--      reference; DISPUTE_LOST: the LOST dispute). At most one per purchase; the purchase must already be REVOKED. Never updated
--      or deleted.
-- Nothing here stores a provider fee, refunds anything, touches a ledger / invoice / credit note, or implies legal / tax approval.
--
-- Rollback (manual, only if no dispute or revocation was ever recorded and no purchase is DISPUTED):
--   DROP TABLE "lead_purchase_revocations"; DROP TABLE "lead_fee_disputes";
--   DROP TRIGGER lead_purchases_dispute_guard_trg ON "lead_purchases"; DROP FUNCTION lead_purchases_dispute_guard();
--   DROP FUNCTION lead_fee_disputes_validate_insert(); DROP FUNCTION lead_fee_disputes_guard_update(); DROP FUNCTION lead_fee_disputes_no_delete();
--   DROP FUNCTION lead_purchase_revocations_validate_insert(); DROP FUNCTION lead_purchase_revocations_append_only();
--   DROP TYPE "LeadPurchaseRevocationSource"; DROP TYPE "LeadFeeDisputeEvidenceStatus"; DROP TYPE "LeadFeeDisputeStatus";
--   DROP INDEX "lead_purchases_one_active_per_lead_professional";
--   CREATE UNIQUE INDEX "lead_purchases_one_active_per_lead_professional" ON "lead_purchases" ("leadId", "professionalProfileId")
--       WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED');
--   (the enum value DISPUTED itself cannot be dropped; see the previous migration.)

-- 1. Active-purchase uniqueness now includes DISPUTED (keep in sync with ACTIVE_LEAD_PURCHASE_STATUSES in the domain).
DROP INDEX "lead_purchases_one_active_per_lead_professional";
CREATE UNIQUE INDEX "lead_purchases_one_active_per_lead_professional"
    ON "lead_purchases" ("leadId", "professionalProfileId")
    WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "LeadFeeDisputeStatus" AS ENUM ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'WON', 'LOST', 'WARNING_CLOSED');
CREATE TYPE "LeadFeeDisputeEvidenceStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMISSION_PENDING', 'SUBMITTED');
CREATE TYPE "LeadPurchaseRevocationSource" AS ENUM ('ADMIN', 'DISPUTE_LOST');

-- CreateTable
CREATE TABLE "lead_fee_disputes" (
    "id" UUID NOT NULL,
    "providerDisputeId" TEXT NOT NULL,
    "leadPurchaseId" UUID NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "providerChargeId" TEXT NOT NULL,
    "status" "LeadFeeDisputeStatus" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" VARCHAR(100),
    "evidenceDueBy" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "lastProviderEventId" TEXT NOT NULL,
    "lastProviderEventAt" TIMESTAMP(3) NOT NULL,
    "evidenceStatus" "LeadFeeDisputeEvidenceStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "evidenceReference" VARCHAR(200),
    "evidenceText" VARCHAR(1000),
    "evidenceActorUserId" UUID,
    "evidenceRequestedAt" TIMESTAMP(3),
    "evidenceSubmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_fee_disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_purchase_revocations" (
    "id" UUID NOT NULL,
    "leadPurchaseId" UUID NOT NULL,
    "source" "LeadPurchaseRevocationSource" NOT NULL,
    "actorUserId" UUID,
    "explanation" VARCHAR(1000),
    "evidenceReference" VARCHAR(200),
    "leadFeeDisputeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_purchase_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_fee_disputes_providerDisputeId_key" ON "lead_fee_disputes"("providerDisputeId");
CREATE INDEX "lead_fee_disputes_leadPurchaseId_idx" ON "lead_fee_disputes"("leadPurchaseId");
CREATE INDEX "lead_fee_disputes_status_idx" ON "lead_fee_disputes"("status");
CREATE UNIQUE INDEX "lead_purchase_revocations_leadPurchaseId_key" ON "lead_purchase_revocations"("leadPurchaseId");
CREATE UNIQUE INDEX "lead_purchase_revocations_leadFeeDisputeId_key" ON "lead_purchase_revocations"("leadFeeDisputeId");

-- AddForeignKey
ALTER TABLE "lead_fee_disputes" ADD CONSTRAINT "lead_fee_disputes_leadPurchaseId_fkey" FOREIGN KEY ("leadPurchaseId") REFERENCES "lead_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SQL-only FK (the Prisma model keeps the actor a plain scalar).
ALTER TABLE "lead_fee_disputes" ADD CONSTRAINT "lead_fee_disputes_evidenceActorUserId_fkey" FOREIGN KEY ("evidenceActorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_purchase_revocations" ADD CONSTRAINT "lead_purchase_revocations_leadPurchaseId_fkey" FOREIGN KEY ("leadPurchaseId") REFERENCES "lead_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_purchase_revocations" ADD CONSTRAINT "lead_purchase_revocations_leadFeeDisputeId_fkey" FOREIGN KEY ("leadFeeDisputeId") REFERENCES "lead_fee_disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_purchase_revocations" ADD CONSTRAINT "lead_purchase_revocations_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money / shape CHECKs (Prisma cannot express them).
ALTER TABLE "lead_fee_disputes" ADD CONSTRAINT "lead_fee_disputes_amount_currency_check"
    CHECK ("amount" > 0 AND "currency" = 'EUR');
ALTER TABLE "lead_fee_disputes" ADD CONSTRAINT "lead_fee_disputes_mandatory_text_check"
    CHECK (
        length(btrim("providerDisputeId")) > 0
        AND length(btrim("paymentReference")) > 0
        AND length(btrim("providerChargeId")) > 0
        AND length(btrim("lastProviderEventId")) > 0
    );
-- closedAt exists exactly when the dispute is terminal.
ALTER TABLE "lead_fee_disputes" ADD CONSTRAINT "lead_fee_disputes_closed_at_check"
    CHECK (("status" IN ('WON', 'LOST', 'WARNING_CLOSED')) = ("closedAt" IS NOT NULL));
-- The evidence columns are all absent (NOT_SUBMITTED), requested but not submitted (SUBMISSION_PENDING), or all present (SUBMITTED).
ALTER TABLE "lead_fee_disputes" ADD CONSTRAINT "lead_fee_disputes_evidence_fields_check"
    CHECK (
        ("evidenceStatus" = 'NOT_SUBMITTED'
            AND "evidenceReference" IS NULL AND "evidenceText" IS NULL AND "evidenceActorUserId" IS NULL
            AND "evidenceRequestedAt" IS NULL AND "evidenceSubmittedAt" IS NULL)
        OR ("evidenceStatus" = 'SUBMISSION_PENDING'
            AND "evidenceReference" IS NOT NULL AND "evidenceText" IS NOT NULL AND "evidenceActorUserId" IS NOT NULL
            AND "evidenceRequestedAt" IS NOT NULL AND "evidenceSubmittedAt" IS NULL)
        OR ("evidenceStatus" = 'SUBMITTED'
            AND "evidenceReference" IS NOT NULL AND "evidenceText" IS NOT NULL AND "evidenceActorUserId" IS NOT NULL
            AND "evidenceRequestedAt" IS NOT NULL AND "evidenceSubmittedAt" IS NOT NULL)
    );
ALTER TABLE "lead_fee_disputes" ADD CONSTRAINT "lead_fee_disputes_evidence_text_check"
    CHECK (
        ("evidenceText" IS NULL OR length(btrim("evidenceText")) BETWEEN 1 AND 1000)
        AND ("evidenceReference" IS NULL OR length(btrim("evidenceReference")) > 0)
    );

-- Revocation shape: an ADMIN revocation names its actor, explanation and evidence reference; a DISPUTE_LOST one names its dispute.
ALTER TABLE "lead_purchase_revocations" ADD CONSTRAINT "lead_purchase_revocations_source_check"
    CHECK (
        ("source" = 'ADMIN'
            AND "actorUserId" IS NOT NULL
            AND "explanation" IS NOT NULL AND length(btrim("explanation")) BETWEEN 1 AND 1000
            AND "evidenceReference" IS NOT NULL AND length(btrim("evidenceReference")) > 0
            AND "leadFeeDisputeId" IS NULL)
        OR ("source" = 'DISPUTE_LOST'
            AND "leadFeeDisputeId" IS NOT NULL
            AND "actorUserId" IS NULL AND "explanation" IS NULL AND "evidenceReference" IS NULL)
    );

-- ---------------------------------------------------------------------------------------------------------------------
-- lead_fee_disputes: INSERT guard (bare row, cross-checked against the authoritative purchase snapshot).
CREATE OR REPLACE FUNCTION lead_fee_disputes_validate_insert() RETURNS trigger AS $$
DECLARE
    pur RECORD;
BEGIN
    IF NEW."evidenceStatus" <> 'NOT_SUBMITTED' OR NEW."evidenceReference" IS NOT NULL OR NEW."evidenceText" IS NOT NULL
       OR NEW."evidenceActorUserId" IS NOT NULL OR NEW."evidenceRequestedAt" IS NOT NULL OR NEW."evidenceSubmittedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'lead_fee_disputes must be inserted without evidence'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT "paymentReference", "totalAmount", "currency" INTO pur FROM "lead_purchases" WHERE "id" = NEW."leadPurchaseId" FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lead_fee_disputes requires an existing lead purchase'
            USING ERRCODE = 'check_violation';
    END IF;

    IF pur."paymentReference" IS NULL
       OR pur."paymentReference" IS DISTINCT FROM NEW."paymentReference"
       OR pur."totalAmount" IS NULL
       OR pur."currency" IS DISTINCT FROM NEW."currency"
       OR NEW."amount" > pur."totalAmount" THEN
        RAISE EXCEPTION 'lead_fee_disputes does not match the purchase snapshot (payment reference, currency, amount)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_disputes_validate_insert_trg
    BEFORE INSERT ON "lead_fee_disputes"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_disputes_validate_insert();

-- lead_fee_disputes: UPDATE guard (immutable identity / money, forward-only status, write-once stamps, evidence state machine).
CREATE OR REPLACE FUNCTION lead_fee_disputes_guard_update() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."providerDisputeId" IS DISTINCT FROM OLD."providerDisputeId"
       OR NEW."leadPurchaseId" IS DISTINCT FROM OLD."leadPurchaseId"
       OR NEW."paymentReference" IS DISTINCT FROM OLD."paymentReference"
       OR NEW."providerChargeId" IS DISTINCT FROM OLD."providerChargeId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."openedAt" IS DISTINCT FROM OLD."openedAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'lead_fee_disputes identity / money columns are immutable (dispute %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN
        RAISE EXCEPTION 'lead_fee_disputes closedAt is write-once (dispute %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."lastProviderEventAt" < OLD."lastProviderEventAt" THEN
        RAISE EXCEPTION 'lead_fee_disputes lastProviderEventAt cannot move backwards (dispute %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."status" <> OLD."status" AND NOT (
           (OLD."status" = 'NEEDS_RESPONSE' AND NEW."status" IN ('UNDER_REVIEW', 'WON', 'LOST', 'WARNING_CLOSED'))
        OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('WON', 'LOST', 'WARNING_CLOSED'))
    ) THEN
        RAISE EXCEPTION 'lead_fee_disputes illegal status transition % -> % (dispute %)', OLD."status", NEW."status", OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."evidenceStatus" <> OLD."evidenceStatus" THEN
        IF NOT (
               (OLD."evidenceStatus" = 'NOT_SUBMITTED' AND NEW."evidenceStatus" = 'SUBMISSION_PENDING')
            OR (OLD."evidenceStatus" = 'SUBMISSION_PENDING' AND NEW."evidenceStatus" IN ('SUBMITTED', 'NOT_SUBMITTED'))
        ) THEN
            RAISE EXCEPTION 'lead_fee_disputes illegal evidence transition % -> % (dispute %)', OLD."evidenceStatus", NEW."evidenceStatus", OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        -- Evidence can only be requested while the dispute still needs a response.
        IF NEW."evidenceStatus" = 'SUBMISSION_PENDING' AND NEW."status" <> 'NEEDS_RESPONSE' THEN
            RAISE EXCEPTION 'lead_fee_disputes evidence can only be requested while the dispute needs a response (dispute %)', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF OLD."evidenceStatus" <> 'NOT_SUBMITTED' AND (
           NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
        OR NEW."evidenceText" IS DISTINCT FROM OLD."evidenceText"
        OR NEW."evidenceActorUserId" IS DISTINCT FROM OLD."evidenceActorUserId"
        OR NEW."evidenceRequestedAt" IS DISTINCT FROM OLD."evidenceRequestedAt"
        OR NEW."evidenceSubmittedAt" IS DISTINCT FROM OLD."evidenceSubmittedAt"
    ) THEN
        RAISE EXCEPTION 'lead_fee_disputes evidence columns are immutable outside a state change (dispute %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    -- Within SUBMISSION_PENDING -> SUBMITTED the claimed evidence must not be altered.
    IF OLD."evidenceStatus" = 'SUBMISSION_PENDING' AND NEW."evidenceStatus" = 'SUBMITTED' AND (
           NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
        OR NEW."evidenceText" IS DISTINCT FROM OLD."evidenceText"
        OR NEW."evidenceActorUserId" IS DISTINCT FROM OLD."evidenceActorUserId"
        OR NEW."evidenceRequestedAt" IS DISTINCT FROM OLD."evidenceRequestedAt"
    ) THEN
        RAISE EXCEPTION 'lead_fee_disputes submitted evidence must equal the claimed evidence (dispute %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_disputes_guard_update_trg
    BEFORE UPDATE ON "lead_fee_disputes"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_disputes_guard_update();

-- lead_fee_disputes: DELETE is never allowed (dispute history is preserved).
CREATE OR REPLACE FUNCTION lead_fee_disputes_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_fee_disputes is never deleted from (dispute %)', OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_disputes_no_delete_trg
    BEFORE DELETE ON "lead_fee_disputes"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_disputes_no_delete();

-- ---------------------------------------------------------------------------------------------------------------------
-- lead_purchases: a purchase is DISPUTED exactly while an open dispute is recorded for it.
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
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_purchases_dispute_guard_trg
    BEFORE INSERT OR UPDATE ON "lead_purchases"
    FOR EACH ROW EXECUTE FUNCTION lead_purchases_dispute_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- lead_purchase_revocations: the purchase must already be REVOKED (same transaction); DISPUTE_LOST names a LOST dispute of THIS purchase.
CREATE OR REPLACE FUNCTION lead_purchase_revocations_validate_insert() RETURNS trigger AS $$
DECLARE
    pur_status "LeadPurchaseStatus";
    pur_revoked_at TIMESTAMP(3);
    disp RECORD;
BEGIN
    SELECT "status", "revokedAt" INTO pur_status, pur_revoked_at FROM "lead_purchases" WHERE "id" = NEW."leadPurchaseId" FOR SHARE;
    IF NOT FOUND OR pur_status <> 'REVOKED' OR pur_revoked_at IS NULL THEN
        RAISE EXCEPTION 'lead_purchase_revocations requires a REVOKED purchase with revokedAt'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."source" = 'DISPUTE_LOST' THEN
        SELECT "leadPurchaseId", "status" INTO disp FROM "lead_fee_disputes" WHERE "id" = NEW."leadFeeDisputeId";
        IF NOT FOUND OR disp."leadPurchaseId" <> NEW."leadPurchaseId" OR disp."status" <> 'LOST' THEN
            RAISE EXCEPTION 'lead_purchase_revocations DISPUTE_LOST requires a LOST dispute of the same purchase'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_purchase_revocations_validate_insert_trg
    BEFORE INSERT ON "lead_purchase_revocations"
    FOR EACH ROW EXECUTE FUNCTION lead_purchase_revocations_validate_insert();

CREATE OR REPLACE FUNCTION lead_purchase_revocations_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_purchase_revocations is append-only (revocation %)', OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_purchase_revocations_append_only_trg
    BEFORE UPDATE OR DELETE ON "lead_purchase_revocations"
    FOR EACH ROW EXECUTE FUNCTION lead_purchase_revocations_append_only();
