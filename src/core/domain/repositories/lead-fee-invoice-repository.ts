import type { LeadFeeInvoiceDraft, LeadFeeInvoiceRecord } from "@/domain/services/lead-fee-invoice";

/**
 * Module 150 — persistence port of the lead-fee invoice.
 *
 * Deliberately no update / delete / cancel: an invoice row is immutable (DB trigger). Corrections and credit notes
 * are a later module (M151). The ONLY writer is `issue`, which does everything in ONE database transaction:
 * serialise per ledger entry, re-check the recipient's billing identity at the snapshotted revision, allocate the
 * invoice number and insert the row — so a failure leaves no invoice AND no consumed number.
 */
export interface LeadFeeInvoiceRepository {
  /**
   * Issues the invoice for `draft.ledgerEntryId` unless one already exists. Safe under concurrency: exactly one caller
   * (`created: true`) allocates a number and inserts; every other caller receives the SAME invoice (`created: false`)
   * and consumes no number. Throws LeadFeeInvoiceNotIssuableError("BILLING_IDENTITY_CHANGED") when the recipient's
   * identity is no longer VERIFIED at `draft.billingIdentityRevision`; any other database error propagates.
   */
  issue(draft: LeadFeeInvoiceDraft): Promise<{ created: boolean; invoice: LeadFeeInvoiceRecord }>;
  findByLedgerEntryId(ledgerEntryId: string): Promise<LeadFeeInvoiceRecord | null>;
  findByLeadPurchaseId(leadPurchaseId: string): Promise<LeadFeeInvoiceRecord | null>;
}
