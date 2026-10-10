-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints and triggers cannot be expressed in schema.prisma).
--
-- Module 151 — Lead-Fee Credit Notes. Purely ADDITIVE: one new table, its indexes, CHECK constraints and two
-- triggers. No existing table, column, row or trigger is altered, rewritten or backfilled. In particular the
-- M150 invoice table and the M149 ledger table are NOT modified (the Prisma relation field added to the
-- LeadFeeInvoice model in schema.prisma has no database column).
--
-- Policy encoded here (NO legal policy for partial credits / correction windows / VAT treatment of credits exists in
-- the repository, so none is invented): a credit note is a FULL credit of exactly one M150 lead-fee invoice.
--   1. leadFeeInvoiceId is UNIQUE  -> at most ONE credit note per invoice (so a cumulative over-credit is impossible by
--      construction) and the FK to lead_fee_invoices is ON DELETE RESTRICT (an invoice with a credit note cannot be deleted);
--   2. creditNoteNumber is UNIQUE and has the "LFC-YYYY-NNNNNN" shape; it can never equal an LFI invoice number or a
--      legacy INV / CN number (different prefix, enforced by CHECK on both sides of the comparison);
--   3. creditKind is 'FULL'; currency is 'EUR'; credited net > 0, tax >= 0, total = net + tax (exact Decimal(10,2), POSITIVE
--      amounts: a credit note is its own document, not a negative invoice);
--   4. INSERT is cross-checked against the authoritative invoice: invoice number / issue time, ledger entry, purchase, lead,
--      professional, currency, tax rate and policy version, issuer and recipient snapshot and all three amounts must be
--      identical to the invoice's, so the credit note can neither exceed nor under-credit it;
--   5. the credit note is append-only: UPDATE and DELETE are rejected (TRUNCATE is unaffected, as for the invoice/ledger/tests).
-- Rollback (only if no credit note must be kept): DROP TABLE "lead_fee_credit_notes";
--           DROP FUNCTION lead_fee_credit_notes_validate_insert(); DROP FUNCTION lead_fee_credit_notes_append_only();
--           and optionally DELETE FROM "invoice_number_counters" WHERE "series" = 'LFC';

-- CreateTable
CREATE TABLE "lead_fee_credit_notes" (
    "id" UUID NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "leadFeeInvoiceId" UUID NOT NULL,
    "originalInvoiceNumber" TEXT NOT NULL,
    "originalInvoiceIssuedAt" TIMESTAMP(3) NOT NULL,
    "ledgerEntryId" UUID NOT NULL,
    "leadPurchaseId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "creditKind" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "currency" TEXT NOT NULL,
    "creditedNetAmount" DECIMAL(10,2) NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "creditedTaxAmount" DECIMAL(10,2) NOT NULL,
    "creditedTotalAmount" DECIMAL(10,2) NOT NULL,
    "taxPolicyVersion" TEXT NOT NULL,
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
    "rulesVersion" TEXT NOT NULL,
    "policyApprovalReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_fee_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_fee_credit_notes_creditNoteNumber_key" ON "lead_fee_credit_notes"("creditNoteNumber");
CREATE UNIQUE INDEX "lead_fee_credit_notes_leadFeeInvoiceId_key" ON "lead_fee_credit_notes"("leadFeeInvoiceId");
CREATE INDEX "lead_fee_credit_notes_leadPurchaseId_idx" ON "lead_fee_credit_notes"("leadPurchaseId");
CREATE INDEX "lead_fee_credit_notes_professionalProfileId_issuedAt_idx" ON "lead_fee_credit_notes"("professionalProfileId", "issuedAt");
CREATE INDEX "lead_fee_credit_notes_issuedAt_idx" ON "lead_fee_credit_notes"("issuedAt");

-- AddForeignKey
ALTER TABLE "lead_fee_credit_notes" ADD CONSTRAINT "lead_fee_credit_notes_leadFeeInvoiceId_fkey" FOREIGN KEY ("leadFeeInvoiceId") REFERENCES "lead_fee_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money / shape CHECKs (Prisma cannot express them).
ALTER TABLE "lead_fee_credit_notes" ADD CONSTRAINT "lead_fee_credit_notes_amounts_check"
    CHECK ("creditedNetAmount" > 0 AND "creditedTaxAmount" >= 0 AND "creditedTotalAmount" = "creditedNetAmount" + "creditedTaxAmount" AND "taxRateBps" BETWEEN 0 AND 10000);
ALTER TABLE "lead_fee_credit_notes" ADD CONSTRAINT "lead_fee_credit_notes_number_check"
    CHECK ("creditNoteNumber" ~ '^LFC-[0-9]{4}-[0-9]{6,}$' AND "originalInvoiceNumber" ~ '^LFI-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "lead_fee_credit_notes" ADD CONSTRAINT "lead_fee_credit_notes_kind_currency_check"
    CHECK ("creditKind" = 'FULL' AND "currency" = 'EUR');
ALTER TABLE "lead_fee_credit_notes" ADD CONSTRAINT "lead_fee_credit_notes_codes_check"
    CHECK ("recipientTaxCountry" ~ '^[A-Z]{2}$' AND "recipientCountry" ~ '^[A-Z]{2}$');
ALTER TABLE "lead_fee_credit_notes" ADD CONSTRAINT "lead_fee_credit_notes_mandatory_text_check"
    CHECK (
        length(btrim("reason")) > 0
        AND length(btrim("issuerLegalName")) > 0 AND length(btrim("issuerTaxId")) > 0 AND length(btrim("issuerAddress")) > 0
        AND length(btrim("recipientLegalName")) > 0 AND length(btrim("recipientTaxId")) > 0
        AND length(btrim("recipientAddressLine1")) > 0 AND length(btrim("recipientCity")) > 0 AND length(btrim("recipientPostalCode")) > 0
        AND length(btrim("taxPolicyVersion")) > 0 AND length(btrim("rulesVersion")) > 0 AND length(btrim("policyApprovalReference")) > 0
    );
ALTER TABLE "lead_fee_credit_notes" ADD CONSTRAINT "lead_fee_credit_notes_issuer_tax_id_check"
    CHECK ("issuerTaxId" <> 'PENDING-CIF-CONFIRMATION');

-- INSERT guard: the credit note must be an exact FULL credit of an existing lead-fee invoice (every reference, snapshot and
-- amount identical to the invoice's). The invoice is immutable (M150 append-only trigger), so no lock on it is required.
CREATE OR REPLACE FUNCTION lead_fee_credit_notes_validate_insert() RETURNS trigger AS $$
DECLARE
    inv RECORD;
BEGIN
    SELECT * INTO inv FROM "lead_fee_invoices" WHERE "id" = NEW."leadFeeInvoiceId";
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lead_fee_credit_notes requires an existing lead-fee invoice'
            USING ERRCODE = 'check_violation';
    END IF;

    IF inv."invoiceNumber" IS DISTINCT FROM NEW."originalInvoiceNumber"
       OR inv."issuedAt" IS DISTINCT FROM NEW."originalInvoiceIssuedAt"
       OR inv."ledgerEntryId" IS DISTINCT FROM NEW."ledgerEntryId"
       OR inv."leadPurchaseId" IS DISTINCT FROM NEW."leadPurchaseId"
       OR inv."leadId" IS DISTINCT FROM NEW."leadId"
       OR inv."professionalProfileId" IS DISTINCT FROM NEW."professionalProfileId"
       OR inv."currency" IS DISTINCT FROM NEW."currency"
       OR inv."netFeeAmount" IS DISTINCT FROM NEW."creditedNetAmount"
       OR inv."taxRateBps" IS DISTINCT FROM NEW."taxRateBps"
       OR inv."taxAmount" IS DISTINCT FROM NEW."creditedTaxAmount"
       OR inv."totalAmount" IS DISTINCT FROM NEW."creditedTotalAmount"
       OR inv."taxPolicyVersion" IS DISTINCT FROM NEW."taxPolicyVersion"
       OR inv."issuerLegalName" IS DISTINCT FROM NEW."issuerLegalName"
       OR inv."issuerTaxId" IS DISTINCT FROM NEW."issuerTaxId"
       OR inv."issuerAddress" IS DISTINCT FROM NEW."issuerAddress"
       OR inv."recipientEntityType" IS DISTINCT FROM NEW."recipientEntityType"
       OR inv."recipientLegalName" IS DISTINCT FROM NEW."recipientLegalName"
       OR inv."recipientTaxId" IS DISTINCT FROM NEW."recipientTaxId"
       OR inv."recipientTaxCountry" IS DISTINCT FROM NEW."recipientTaxCountry"
       OR inv."recipientAddressLine1" IS DISTINCT FROM NEW."recipientAddressLine1"
       OR inv."recipientAddressLine2" IS DISTINCT FROM NEW."recipientAddressLine2"
       OR inv."recipientCity" IS DISTINCT FROM NEW."recipientCity"
       OR inv."recipientRegion" IS DISTINCT FROM NEW."recipientRegion"
       OR inv."recipientPostalCode" IS DISTINCT FROM NEW."recipientPostalCode"
       OR inv."recipientCountry" IS DISTINCT FROM NEW."recipientCountry" THEN
        RAISE EXCEPTION 'lead_fee_credit_notes row does not match its source lead-fee invoice'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_credit_notes_validate_insert_trg
    BEFORE INSERT ON "lead_fee_credit_notes"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_credit_notes_validate_insert();

-- Append-only: an issued credit note can never be changed or removed.
CREATE OR REPLACE FUNCTION lead_fee_credit_notes_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_fee_credit_notes is append-only (% rejected for credit note %)', TG_OP, OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_fee_credit_notes_append_only_trg
    BEFORE UPDATE OR DELETE ON "lead_fee_credit_notes"
    FOR EACH ROW EXECUTE FUNCTION lead_fee_credit_notes_append_only();
