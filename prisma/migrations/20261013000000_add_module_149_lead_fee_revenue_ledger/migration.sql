-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints and the append-only trigger cannot be expressed in schema.prisma).
--
-- Module 149 — Lead-Fee Revenue Ledger. Purely ADDITIVE: one enum, one new table, its indexes,
-- CHECK constraints and an append-only trigger. No existing table, column, row or trigger is
-- altered, rewritten or backfilled.
--
-- Guarantees:
--   1. at most ONE entry per (leadPurchaseId, entryType)  -> one successful payment, one entry;
--   2. at most ONE entry per (paymentReference, entryType) -> a provider payment is never recorded twice;
--   3. totalCollectedAmount = netFeeAmount + taxAmount, net > 0, tax >= 0 (exact Decimal(10,2));
--   4. the ledger is append-only: UPDATE and DELETE are rejected (TRUNCATE is unaffected, as for tests);
--   5. the FK to lead_purchases is ON DELETE RESTRICT: a recorded purchase can never be deleted.
-- Rollback (only if no entry must be kept): DROP TABLE "lead_fee_ledger_entries";
--           DROP FUNCTION lead_fee_ledger_entries_append_only(); DROP TYPE "LeadFeeLedgerEntryType";

-- CreateEnum
CREATE TYPE "LeadFeeLedgerEntryType" AS ENUM ('LEAD_FEE_PAYMENT_SUCCEEDED');

-- CreateTable
CREATE TABLE "lead_fee_ledger_entries" (
    "id" UUID NOT NULL,
    "entryType" "LeadFeeLedgerEntryType" NOT NULL,
    "leadPurchaseId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerEventCreatedAt" TIMESTAMP(3),
    "netFeeAmount" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "totalCollectedAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "taxPolicyVersion" TEXT NOT NULL,
    "pricingConfigVersion" TEXT,
    "pricingRuleVersion" TEXT,
    "paymentConfirmedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_fee_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_fee_ledger_entries_leadPurchaseId_entryType_key" ON "lead_fee_ledger_entries"("leadPurchaseId", "entryType");
CREATE UNIQUE INDEX "lead_fee_ledger_entries_paymentReference_entryType_key" ON "lead_fee_ledger_entries"("paymentReference", "entryType");
CREATE INDEX "lead_fee_ledger_entries_leadId_idx" ON "lead_fee_ledger_entries"("leadId");
CREATE INDEX "lead_fee_ledger_entries_professionalProfileId_recordedAt_idx" ON "lead_fee_ledger_entries"("professionalProfileId", "recordedAt");
CREATE INDEX "lead_fee_ledger_entries_recordedAt_idx" ON "lead_fee_ledger_entries"("recordedAt");

-- AddForeignKey
ALTER TABLE "lead_fee_ledger_entries" ADD CONSTRAINT "lead_fee_ledger_entries_leadPurchaseId_fkey" FOREIGN KEY ("leadPurchaseId") REFERENCES "lead_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money / identity CHECKs (Prisma cannot express them).
ALTER TABLE "lead_fee_ledger_entries" ADD CONSTRAINT "lead_fee_ledger_entries_amounts_check"
    CHECK ("netFeeAmount" > 0 AND "taxAmount" >= 0 AND "totalCollectedAmount" = "netFeeAmount" + "taxAmount");
ALTER TABLE "lead_fee_ledger_entries" ADD CONSTRAINT "lead_fee_ledger_entries_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "lead_fee_ledger_entries" ADD CONSTRAINT "lead_fee_ledger_entries_references_check"
    CHECK (length("paymentReference") > 0 AND length("providerEventId") > 0);

-- Append-only: a ledger entry can never be changed or removed (corrections are NEW entries by later modules).
CREATE OR REPLACE FUNCTION lead_fee_ledger_entries_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_fee_ledger_entries is append-only (% rejected for entry %)', TG_OP, OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_ledger_entries_append_only_trg
    BEFORE UPDATE OR DELETE ON "lead_fee_ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_ledger_entries_append_only();
