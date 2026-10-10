import type { LeadFeeCreditNoteDraft, LeadFeeCreditNoteRecord } from "@/domain/services/lead-fee-credit-note";

/**
 * Module 151 — persistence port of the lead-fee credit note.
 *
 * Deliberately no update / delete / cancel: a credit note row is immutable (DB trigger). The ONLY writer is `issue`,
 * which does everything in ONE database transaction: serialise per invoice, return the existing credit note if there is
 * one, allocate the credit-note number and insert the row — so a failure leaves no credit note AND no consumed number.
 * It never reads or writes the invoice, the M149 ledger, the lead purchase, Stripe or any balance: the database
 * cross-checks the draft against the invoice on INSERT.
 */
export interface LeadFeeCreditNoteRepository {
  /**
   * Issues the credit note for `draft.leadFeeInvoiceId` unless one already exists. Safe under concurrency: exactly one
   * caller (`created: true`) allocates a number and inserts; every other caller receives the SAME credit note
   * (`created: false`) and consumes no number. Any database error (including a trigger rejecting a forged draft)
   * propagates and leaves nothing behind.
   */
  issue(draft: LeadFeeCreditNoteDraft): Promise<{ created: boolean; creditNote: LeadFeeCreditNoteRecord }>;
  findByInvoiceId(leadFeeInvoiceId: string): Promise<LeadFeeCreditNoteRecord | null>;
  findByLeadPurchaseId(leadPurchaseId: string): Promise<LeadFeeCreditNoteRecord | null>;
}
