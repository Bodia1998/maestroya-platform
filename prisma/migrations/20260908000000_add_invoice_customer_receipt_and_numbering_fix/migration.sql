-- Module 85 — Invoicing & Credit Note Activation.
--
-- 1. New InvoiceType value: CUSTOMER_RECEIPT — the genuine customer-
--    facing document (see InvoiceRepository's own InvoiceTypeValue doc
--    comment). A CUSTOMER_RECEIPT row has no self-billing authorization,
--    so selfBillingAuthorizationId must become nullable.
-- 2. The original invoices_active_job_unique index enforced "at most one
--    non-CANCELLED invoice per Job" across ALL types. A Job now
--    legitimately carries up to one non-CANCELLED invoice of EACH type
--    (its PROFESSIONAL_SELF_BILLED self-billing invoice AND its
--    CUSTOMER_RECEIPT) — replaced with a (jobId, type) scoped unique
--    index that preserves the original "no duplicate active document of
--    the same kind" guarantee per type.

ALTER TYPE "InvoiceType" ADD VALUE 'CUSTOMER_RECEIPT';

ALTER TABLE "invoices" ALTER COLUMN "selfBillingAuthorizationId" DROP NOT NULL;

DROP INDEX "invoices_active_job_unique";

CREATE UNIQUE INDEX "invoices_active_job_type_unique"
    ON "invoices"("jobId", "type")
    WHERE "status" <> 'CANCELLED';
