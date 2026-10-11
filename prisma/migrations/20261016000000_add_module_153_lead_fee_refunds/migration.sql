-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints, partial indexes and triggers cannot be expressed in schema.prisma).
--
-- Module 153 — Lead-Fee Refund Execution. Purely ADDITIVE: two enums, one new table, its indexes, CHECK constraints
-- and three triggers. No existing table, column, row or trigger is altered, rewritten or backfilled. In particular the
-- M135/M140 purchase financial-immutability trigger, the M149 ledger, the M150 invoices and the M151 credit notes are
-- NOT touched (the Prisma relation field added to LeadPurchase has no database column).
--
-- One row = one refund ATTEMPT of a provider payment. Guarantees encoded here:
--   1. at most ONE active attempt per provider payment: a partial UNIQUE index over (refundedPaymentReference) for the
--      statuses REQUESTED / PROVIDER_PENDING / UNKNOWN / SUCCEEDED. A SUCCEEDED refund is therefore never refunded again,
--      an unresolved attempt blocks any new one, and concurrent executions race on the index (one wins);
--   2. (refundedPaymentReference, attemptNumber) and idempotencyKey are UNIQUE; providerRefundId is UNIQUE and write-once;
--   3. a retry (attemptNumber > 1) is only insertable when the previous attempt of that payment is FAILED;
--   4. money is EUR, > 0 and EQUAL to the purchase's persisted snapshot total (100% refund); the purchase must be CONFIRMED
--      and its stored payment reference must equal purchasePaymentReference; PLATFORM_ERROR refunds the purchase's own
--      payment, DUPLICATE_CHARGE a DIFFERENT one;
--   5. money / identity / actor / explanation / evidence columns are immutable; status moves forward only
--      (REQUESTED -> PROVIDER_PENDING | UNKNOWN | SUCCEEDED | FAILED; PROVIDER_PENDING -> SUCCEEDED | FAILED;
--      UNKNOWN -> PROVIDER_PENDING | SUCCEEDED | FAILED; SUCCEEDED and FAILED are terminal);
--   6. rows are never deleted (history is preserved). TRUNCATE is unaffected, as for the ledger/invoice/credit-note tables.
-- Nothing here stores a provider fee, touches a ledger/invoice/credit note, or implies legal/tax approval.
--
-- Rollback (manual, only if no refund attempt was ever recorded): DROP TABLE "lead_fee_refunds";
--           DROP FUNCTION lead_fee_refunds_validate_insert(); DROP FUNCTION lead_fee_refunds_guard_update();
--           DROP FUNCTION lead_fee_refunds_no_delete(); DROP TYPE "LeadFeeRefundStatus"; DROP TYPE "LeadFeeRefundReason";

-- CreateEnum
CREATE TYPE "LeadFeeRefundReason" AS ENUM ('PLATFORM_ERROR', 'DUPLICATE_CHARGE');

-- CreateEnum
CREATE TYPE "LeadFeeRefundStatus" AS ENUM ('REQUESTED', 'PROVIDER_PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "lead_fee_refunds" (
    "id" UUID NOT NULL,
    "leadPurchaseId" UUID NOT NULL,
    "reasonCode" "LeadFeeRefundReason" NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "LeadFeeRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "refundedPaymentReference" TEXT NOT NULL,
    "purchasePaymentReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "actorUserId" UUID NOT NULL,
    "explanation" VARCHAR(1000) NOT NULL,
    "evidenceReference" VARCHAR(200) NOT NULL,
    "failureCategory" VARCHAR(60),
    "purchaseTransitionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_fee_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_fee_refunds_idempotencyKey_key" ON "lead_fee_refunds"("idempotencyKey");
CREATE UNIQUE INDEX "lead_fee_refunds_providerRefundId_key" ON "lead_fee_refunds"("providerRefundId");
CREATE UNIQUE INDEX "lead_fee_refunds_refundedPaymentReference_attemptNumber_key" ON "lead_fee_refunds"("refundedPaymentReference", "attemptNumber");
CREATE INDEX "lead_fee_refunds_leadPurchaseId_idx" ON "lead_fee_refunds"("leadPurchaseId");
CREATE INDEX "lead_fee_refunds_status_idx" ON "lead_fee_refunds"("status");

-- At most one ACTIVE attempt per provider payment (hand-authored; Prisma cannot express a partial unique index).
CREATE UNIQUE INDEX "lead_fee_refunds_one_active_per_payment_key" ON "lead_fee_refunds"("refundedPaymentReference")
    WHERE "status" IN ('REQUESTED', 'PROVIDER_PENDING', 'UNKNOWN', 'SUCCEEDED');

-- AddForeignKey
ALTER TABLE "lead_fee_refunds" ADD CONSTRAINT "lead_fee_refunds_leadPurchaseId_fkey" FOREIGN KEY ("leadPurchaseId") REFERENCES "lead_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SQL-only FK (the Prisma model keeps actorUserId a plain scalar).
ALTER TABLE "lead_fee_refunds" ADD CONSTRAINT "lead_fee_refunds_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money / shape CHECKs (Prisma cannot express them).
ALTER TABLE "lead_fee_refunds" ADD CONSTRAINT "lead_fee_refunds_amount_currency_check"
    CHECK ("amount" > 0 AND "currency" = 'EUR' AND "attemptNumber" >= 1);
ALTER TABLE "lead_fee_refunds" ADD CONSTRAINT "lead_fee_refunds_mandatory_text_check"
    CHECK (
        length(btrim("explanation")) BETWEEN 1 AND 1000
        AND length(btrim("evidenceReference")) > 0
        AND length(btrim("refundedPaymentReference")) > 0
        AND length(btrim("purchasePaymentReference")) > 0
        AND length(btrim("idempotencyKey")) > 0
    );
ALTER TABLE "lead_fee_refunds" ADD CONSTRAINT "lead_fee_refunds_reason_payment_check"
    CHECK (
        ("reasonCode" = 'PLATFORM_ERROR' AND "refundedPaymentReference" = "purchasePaymentReference")
        OR ("reasonCode" = 'DUPLICATE_CHARGE' AND "refundedPaymentReference" <> "purchasePaymentReference")
    );
ALTER TABLE "lead_fee_refunds" ADD CONSTRAINT "lead_fee_refunds_status_fields_check"
    CHECK (
        ("status" NOT IN ('PROVIDER_PENDING', 'SUCCEEDED') OR "providerRefundId" IS NOT NULL)
        AND (("status" = 'FAILED') = ("failureCategory" IS NOT NULL))
        AND ("purchaseTransitionedAt" IS NULL OR ("status" = 'SUCCEEDED' AND "reasonCode" = 'PLATFORM_ERROR'))
    );

-- INSERT guard: a new attempt starts REQUESTED and is cross-checked against the authoritative purchase.
CREATE OR REPLACE FUNCTION lead_fee_refunds_validate_insert() RETURNS trigger AS $$
DECLARE
    pur RECORD;
    prev_status "LeadFeeRefundStatus";
BEGIN
    IF NEW."status" <> 'REQUESTED' OR NEW."providerRefundId" IS NOT NULL OR NEW."failureCategory" IS NOT NULL
       OR NEW."purchaseTransitionedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'lead_fee_refunds attempts must be inserted as a bare REQUESTED row'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO pur FROM "lead_purchases" WHERE "id" = NEW."leadPurchaseId" FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lead_fee_refunds requires an existing lead purchase'
            USING ERRCODE = 'check_violation';
    END IF;

    IF pur."status" <> 'CONFIRMED'
       OR pur."paymentReference" IS NULL
       OR pur."paymentReference" IS DISTINCT FROM NEW."purchasePaymentReference"
       OR pur."totalAmount" IS DISTINCT FROM NEW."amount"
       OR pur."currency" IS DISTINCT FROM NEW."currency" THEN
        RAISE EXCEPTION 'lead_fee_refunds attempt does not match a CONFIRMED purchase snapshot (reference, total, currency)'
            USING ERRCODE = 'check_violation';
    END IF;

    -- An EXTRA (duplicate) payment must not be the payment of ANY purchase (lead_purchases.paymentReference is unique).
    -- The purchase's OWN payment is already rejected by lead_fee_refunds_reason_payment_check, so it is left to that CHECK.
    IF NEW."reasonCode" = 'DUPLICATE_CHARGE'
       AND NEW."refundedPaymentReference" <> NEW."purchasePaymentReference"
       AND EXISTS (SELECT 1 FROM "lead_purchases" WHERE "paymentReference" = NEW."refundedPaymentReference") THEN
        RAISE EXCEPTION 'lead_fee_refunds DUPLICATE_CHARGE must refund an extra payment, not a purchase payment'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."attemptNumber" > 1 THEN
        SELECT "status" INTO prev_status FROM "lead_fee_refunds"
            WHERE "refundedPaymentReference" = NEW."refundedPaymentReference" AND "attemptNumber" = NEW."attemptNumber" - 1;
        IF prev_status IS DISTINCT FROM 'FAILED' THEN
            RAISE EXCEPTION 'lead_fee_refunds retry requires the previous attempt to be FAILED'
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM "lead_fee_refunds" WHERE "refundedPaymentReference" = NEW."refundedPaymentReference") THEN
        RAISE EXCEPTION 'lead_fee_refunds first attempt already exists for this payment'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_refunds_validate_insert_trg
    BEFORE INSERT ON "lead_fee_refunds"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_refunds_validate_insert();

-- UPDATE guard: immutable money/identity, forward-only status, write-once provider id / failure category / transition stamp.
CREATE OR REPLACE FUNCTION lead_fee_refunds_guard_update() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."leadPurchaseId" IS DISTINCT FROM OLD."leadPurchaseId"
       OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
       OR NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."refundedPaymentReference" IS DISTINCT FROM OLD."refundedPaymentReference"
       OR NEW."purchasePaymentReference" IS DISTINCT FROM OLD."purchasePaymentReference"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId"
       OR NEW."explanation" IS DISTINCT FROM OLD."explanation"
       OR NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'lead_fee_refunds money / identity / audit columns are immutable (refund %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF (OLD."providerRefundId" IS NOT NULL AND NEW."providerRefundId" IS DISTINCT FROM OLD."providerRefundId")
       OR (OLD."failureCategory" IS NOT NULL AND NEW."failureCategory" IS DISTINCT FROM OLD."failureCategory")
       OR (OLD."purchaseTransitionedAt" IS NOT NULL AND NEW."purchaseTransitionedAt" IS DISTINCT FROM OLD."purchaseTransitionedAt") THEN
        RAISE EXCEPTION 'lead_fee_refunds provider id / failure category / transition stamp are write-once (refund %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."status" <> OLD."status" AND NOT (
           (OLD."status" = 'REQUESTED' AND NEW."status" IN ('PROVIDER_PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED'))
        OR (OLD."status" = 'PROVIDER_PENDING' AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
        OR (OLD."status" = 'UNKNOWN' AND NEW."status" IN ('PROVIDER_PENDING', 'SUCCEEDED', 'FAILED'))
    ) THEN
        RAISE EXCEPTION 'lead_fee_refunds illegal status transition % -> % (refund %)', OLD."status", NEW."status", OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_refunds_guard_update_trg
    BEFORE UPDATE ON "lead_fee_refunds"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_refunds_guard_update();

-- DELETE is never allowed: refund history is preserved.
CREATE OR REPLACE FUNCTION lead_fee_refunds_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_fee_refunds is never deleted from (refund %)', OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_refunds_no_delete_trg
    BEFORE DELETE ON "lead_fee_refunds"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_refunds_no_delete();
