-- Module 79 — Invoicing & Credit Notes
-- Additive-only migration: new enums, new tables, and new nullable
-- relation columns are added below. No existing column is altered or
-- dropped, and no existing table's data is touched.

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE "SelfBillingAuthorizationStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'ISSUED', 'PAID', 'CANCELLED');

CREATE TYPE "InvoiceType" AS ENUM ('PROFESSIONAL_SELF_BILLED');

CREATE TYPE "InvoiceLineItemCategory" AS ENUM ('LABOR', 'MATERIALS');

CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- ============================================================================
-- self_billing_authorizations
-- ============================================================================

CREATE TABLE "self_billing_authorizations" (
    "id" UUID NOT NULL,
    "professionalProfileId" UUID,
    "companyProfileId" UUID,
    "status" "SelfBillingAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "agreementVersion" TEXT NOT NULL,
    "acceptedByUserId" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptanceIpAddress" TEXT,
    "acceptanceUserAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_billing_authorizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "self_billing_authorizations_party_check"
        CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1)
);

ALTER TABLE "self_billing_authorizations"
    ADD CONSTRAINT "self_billing_authorizations_professionalProfileId_fkey"
        FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "self_billing_authorizations_companyProfileId_fkey"
        FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "self_billing_authorizations_acceptedByUserId_fkey"
        FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "self_billing_authorizations_revokedByUserId_fkey"
        FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "self_billing_authorizations_professionalProfileId_status_idx" ON "self_billing_authorizations"("professionalProfileId", "status");
CREATE INDEX "self_billing_authorizations_companyProfileId_status_idx" ON "self_billing_authorizations"("companyProfileId", "status");

-- At most one ACTIVE self-billing authorization per professional/company —
-- see domain/repositories/self-billing-authorization-repository.ts's own
-- doc comment. Partial unique indexes (not representable as a plain
-- @@unique in schema.prisma) are the database-level backstop behind
-- SelfBillingAuthorizationRepository.grant's application-level "revoke the
-- existing ACTIVE row first, in the same transaction" logic.
CREATE UNIQUE INDEX "self_billing_authorizations_active_professional_unique"
    ON "self_billing_authorizations"("professionalProfileId")
    WHERE "status" = 'ACTIVE' AND "professionalProfileId" IS NOT NULL;

CREATE UNIQUE INDEX "self_billing_authorizations_active_company_unique"
    ON "self_billing_authorizations"("companyProfileId")
    WHERE "status" = 'ACTIVE' AND "companyProfileId" IS NOT NULL;

-- ============================================================================
-- invoices
-- ============================================================================

CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoiceNumber" TEXT,
    "type" "InvoiceType" NOT NULL DEFAULT 'PROFESSIONAL_SELF_BILLED',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',

    "jobId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "paymentId" UUID,

    "professionalProfileId" UUID,
    "companyProfileId" UUID,
    "customerId" UUID NOT NULL,

    "issuerLegalName" TEXT NOT NULL,
    "issuerTaxId" TEXT NOT NULL,
    "recipientLegalName" TEXT NOT NULL,
    "recipientTaxId" TEXT,

    "selfBillingAuthorizationId" UUID NOT NULL,

    "issueDate" TIMESTAMP(3),
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" UUID,
    "acceptanceAgreementVersion" TEXT,

    "currency" TEXT NOT NULL DEFAULT 'EUR',

    "taxableBase" DECIMAL(10,2) NOT NULL,
    "vatRateBps" INTEGER NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL,
    "commissionBase" DECIMAL(10,2) NOT NULL,
    "commissionRateBps" INTEGER NOT NULL,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "irpfWithholdingRateBps" INTEGER NOT NULL DEFAULT 0,
    "irpfWithholdingAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,

    "documentHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" UUID,
    "cancellationReason" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_party_check"
        CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1)
);

ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_selfBillingAuthorizationId_fkey" FOREIGN KEY ("selfBillingAuthorizationId") REFERENCES "self_billing_authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");
CREATE INDEX "invoices_jobId_idx" ON "invoices"("jobId");
CREATE INDEX "invoices_professionalProfileId_status_idx" ON "invoices"("professionalProfileId", "status");
CREATE INDEX "invoices_companyProfileId_status_idx" ON "invoices"("companyProfileId", "status");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- At most one non-CANCELLED invoice per Job — see
-- domain/repositories/invoice-repository.ts's own doc comment on
-- InvoiceRepository.createDraft. This is the database-level backstop
-- behind CreateProfessionalInvoiceDraftUseCase's application-level
-- findByJobId idempotency check, same layered strategy as
-- payouts_jobId_key (Module 76).
CREATE UNIQUE INDEX "invoices_active_job_unique"
    ON "invoices"("jobId")
    WHERE "status" <> 'CANCELLED';

-- ============================================================================
-- invoice_line_items
-- ============================================================================

CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "category" "InvoiceLineItemCategory" NOT NULL DEFAULT 'LABOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

-- ============================================================================
-- credit_notes
-- ============================================================================

CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "creditNoteNumber" TEXT,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',

    "originalInvoiceId" UUID NOT NULL,
    "professionalProfileId" UUID,
    "companyProfileId" UUID,

    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    "issueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EUR',

    "reversedTaxableBase" DECIMAL(10,2) NOT NULL,
    "reversedVatRateBps" INTEGER NOT NULL,
    "reversedVatAmount" DECIMAL(10,2) NOT NULL,
    "reversedCommissionAmount" DECIMAL(10,2) NOT NULL,
    "reversedIrpfWithholdingAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,

    "documentHash" TEXT,

    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" UUID,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_notes_party_check"
        CHECK (num_nonnulls("professionalProfileId", "companyProfileId") <= 1)
);

ALTER TABLE "credit_notes"
    ADD CONSTRAINT "credit_notes_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "credit_notes_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "credit_notes_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "credit_notes_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "credit_notes_creditNoteNumber_key" ON "credit_notes"("creditNoteNumber");
CREATE UNIQUE INDEX "credit_notes_idempotencyKey_key" ON "credit_notes"("idempotencyKey");
CREATE INDEX "credit_notes_originalInvoiceId_idx" ON "credit_notes"("originalInvoiceId");
CREATE INDEX "credit_notes_professionalProfileId_idx" ON "credit_notes"("professionalProfileId");
CREATE INDEX "credit_notes_companyProfileId_idx" ON "credit_notes"("companyProfileId");

-- ============================================================================
-- credit_note_line_items
-- ============================================================================

CREATE TABLE "credit_note_line_items" (
    "id" UUID NOT NULL,
    "creditNoteId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_line_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "credit_note_line_items"
    ADD CONSTRAINT "credit_note_line_items_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "credit_note_line_items_creditNoteId_idx" ON "credit_note_line_items"("creditNoteId");

-- ============================================================================
-- invoice_number_counters
-- ============================================================================

CREATE TABLE "invoice_number_counters" (
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY ("series", "year")
);
