-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints and triggers cannot be expressed in schema.prisma).
--
-- Module 150 — Lead-Fee Invoice. Purely ADDITIVE: one new table, its indexes, CHECK constraints and two
-- triggers. No existing table, column, row or trigger is altered, rewritten or backfilled. In particular the
-- M149 ledger table is NOT modified (the Prisma relation field added in schema.prisma has no database column).
--
-- Guarantees:
--   1. invoiceNumber is UNIQUE and has the "LFI-YYYY-NNNNNN" shape;
--   2. at most ONE invoice per ledger entry and per lead purchase (the same payment can never be invoiced twice);
--   3. net > 0, tax >= 0, total = net + tax (exact Decimal(10,2)); currency / country code shapes;
--      every mandatory issuer / recipient / description / approval text is non-blank; the issuer tax id is never
--      the known "PENDING-CIF-CONFIRMATION" placeholder;
--   4. INSERT is cross-checked against the authoritative data: the ledger entry (ids, amounts, currency, tax policy
--      version, confirmation time), a CONFIRMED lead purchase, and a VERIFIED billing identity at exactly the
--      snapshotted revision (row-locked FOR SHARE, so a concurrent edit cannot slip in between);
--   4b. the invoice is append-only: UPDATE and DELETE are rejected (TRUNCATE is unaffected, as for the ledger/tests);
--   5. the FK to lead_fee_ledger_entries is ON DELETE RESTRICT: an invoiced ledger entry can never be deleted.
-- Rollback (only if no invoice must be kept): DROP TABLE "lead_fee_invoices";
--           DROP FUNCTION lead_fee_invoices_validate_insert(); DROP FUNCTION lead_fee_invoices_append_only();
--           and optionally DELETE FROM "invoice_number_counters" WHERE "series" = 'LFI';

-- CreateTable
CREATE TABLE "lead_fee_invoices" (
    "id" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "ledgerEntryId" UUID NOT NULL,
    "leadPurchaseId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "paymentConfirmedAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "netFeeAmount" DECIMAL(10,2) NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "taxPolicyVersion" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "issuerLegalName" TEXT NOT NULL,
    "issuerTaxId" TEXT NOT NULL,
    "issuerAddress" TEXT NOT NULL,
    "recipientEntityType" "BillingEntityType" NOT NULL,
    "recipientLegalName" VARCHAR(200) NOT NULL,
    "recipientTaxId" VARCHAR(20) NOT NULL,
    "recipientTaxCountry" VARCHAR(2) NOT NULL,
    "recipientAddressLine1" VARCHAR(200) NOT NULL,
    "recipientAddressLine2" VARCHAR(200),
    "recipientCity" VARCHAR(120) NOT NULL,
    "recipientRegion" VARCHAR(120),
    "recipientPostalCode" VARCHAR(20) NOT NULL,
    "recipientCountry" VARCHAR(2) NOT NULL,
    "billingIdentityRevision" INTEGER NOT NULL,
    "billingIdentityVerifiedAt" TIMESTAMP(3) NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "policyApprovalReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_fee_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_fee_invoices_invoiceNumber_key" ON "lead_fee_invoices"("invoiceNumber");
CREATE UNIQUE INDEX "lead_fee_invoices_ledgerEntryId_key" ON "lead_fee_invoices"("ledgerEntryId");
CREATE UNIQUE INDEX "lead_fee_invoices_leadPurchaseId_key" ON "lead_fee_invoices"("leadPurchaseId");
CREATE INDEX "lead_fee_invoices_professionalProfileId_issuedAt_idx" ON "lead_fee_invoices"("professionalProfileId", "issuedAt");
CREATE INDEX "lead_fee_invoices_issuedAt_idx" ON "lead_fee_invoices"("issuedAt");

-- AddForeignKey
ALTER TABLE "lead_fee_invoices" ADD CONSTRAINT "lead_fee_invoices_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "lead_fee_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money / shape CHECKs (Prisma cannot express them).
ALTER TABLE "lead_fee_invoices" ADD CONSTRAINT "lead_fee_invoices_amounts_check"
    CHECK ("netFeeAmount" > 0 AND "taxAmount" >= 0 AND "totalAmount" = "netFeeAmount" + "taxAmount" AND "taxRateBps" BETWEEN 0 AND 10000);
ALTER TABLE "lead_fee_invoices" ADD CONSTRAINT "lead_fee_invoices_number_check"
    CHECK ("invoiceNumber" ~ '^LFI-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "lead_fee_invoices" ADD CONSTRAINT "lead_fee_invoices_codes_check"
    CHECK ("currency" ~ '^[A-Z]{3}$' AND "recipientTaxCountry" ~ '^[A-Z]{2}$' AND "recipientCountry" ~ '^[A-Z]{2}$');
ALTER TABLE "lead_fee_invoices" ADD CONSTRAINT "lead_fee_invoices_mandatory_text_check"
    CHECK (
        length(btrim("description")) > 0
        AND length(btrim("issuerLegalName")) > 0 AND length(btrim("issuerTaxId")) > 0 AND length(btrim("issuerAddress")) > 0
        AND length(btrim("recipientLegalName")) > 0 AND length(btrim("recipientTaxId")) > 0
        AND length(btrim("recipientAddressLine1")) > 0 AND length(btrim("recipientCity")) > 0 AND length(btrim("recipientPostalCode")) > 0
        AND length(btrim("taxPolicyVersion")) > 0 AND length(btrim("rulesVersion")) > 0 AND length(btrim("policyApprovalReference")) > 0
    );
ALTER TABLE "lead_fee_invoices" ADD CONSTRAINT "lead_fee_invoices_issuer_tax_id_check"
    CHECK ("issuerTaxId" <> 'PENDING-CIF-CONFIRMATION');
ALTER TABLE "lead_fee_invoices" ADD CONSTRAINT "lead_fee_invoices_billing_revision_check"
    CHECK ("billingIdentityRevision" >= 1);

-- INSERT guard: the invoice must agree with the authoritative ledger entry, a CONFIRMED purchase and a VERIFIED
-- billing identity at exactly the snapshotted revision. FOR SHARE blocks a concurrent identity edit until this
-- transaction ends (the M146 trigger would otherwise reset/bump it between the application check and the insert).
CREATE OR REPLACE FUNCTION lead_fee_invoices_validate_insert() RETURNS trigger AS $$
DECLARE
    ledger RECORD;
    purchase_status TEXT;
    identity RECORD;
BEGIN
    SELECT * INTO ledger FROM "lead_fee_ledger_entries" WHERE "id" = NEW."ledgerEntryId";
    IF NOT FOUND
       OR ledger."entryType"::text <> 'LEAD_FEE_PAYMENT_SUCCEEDED'
       OR ledger."leadPurchaseId" <> NEW."leadPurchaseId"
       OR ledger."leadId" <> NEW."leadId"
       OR ledger."professionalProfileId" <> NEW."professionalProfileId"
       OR ledger."netFeeAmount" <> NEW."netFeeAmount"
       OR ledger."taxAmount" <> NEW."taxAmount"
       OR ledger."totalCollectedAmount" <> NEW."totalAmount"
       OR ledger."currency" <> NEW."currency"
       OR ledger."taxPolicyVersion" <> NEW."taxPolicyVersion"
       OR ledger."paymentConfirmedAt" <> NEW."paymentConfirmedAt" THEN
        RAISE EXCEPTION 'lead_fee_invoices row does not match its lead-fee ledger entry'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT "status"::text INTO purchase_status FROM "lead_purchases" WHERE "id" = NEW."leadPurchaseId";
    IF purchase_status IS DISTINCT FROM 'CONFIRMED' THEN
        RAISE EXCEPTION 'lead_fee_invoices requires a CONFIRMED lead purchase'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT "revision", "verificationStatus"::text AS status, "verifiedAt", "professionalProfileId"
      INTO identity
      FROM "professional_billing_identities"
     WHERE "professionalProfileId" = NEW."professionalProfileId"
       FOR SHARE;
    IF NOT FOUND
       OR identity.status <> 'VERIFIED'
       OR identity."revision" <> NEW."billingIdentityRevision"
       OR identity."verifiedAt" IS DISTINCT FROM NEW."billingIdentityVerifiedAt" THEN
        RAISE EXCEPTION 'lead_fee_invoices requires the VERIFIED billing identity at the snapshotted revision'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_invoices_validate_insert_trg
    BEFORE INSERT ON "lead_fee_invoices"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_invoices_validate_insert();

-- Append-only: an issued invoice can never be changed or removed (corrections are NEW documents, M151).
CREATE OR REPLACE FUNCTION lead_fee_invoices_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_fee_invoices is append-only (% rejected for invoice %)', TG_OP, OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_invoices_append_only_trg
    BEFORE UPDATE OR DELETE ON "lead_fee_invoices"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_invoices_append_only();
