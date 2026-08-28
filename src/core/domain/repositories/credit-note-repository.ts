/**
 * Module 79 — Invoicing & Credit Notes: repository interface for
 * `CreditNote` — the ONLY mechanism this module provides for correcting an
 * already-`ISSUED` `Invoice` (see the module brief's "CREDIT NOTES"
 * section: "Do not implement arbitrary editing of issued invoices as a
 * substitute for credit notes"). A credit note is always a separate
 * financial document referencing its original invoice; the original is
 * never mutated by any method here.
 */

export type CreditNoteStatusValue = "DRAFT" | "ISSUED" | "CANCELLED";

export interface CreditNoteLineItemRecord {
  id: string;
  description: string;
  amount: number;
}

export interface CreditNoteRecord {
  id: string;
  /** Human-readable, sequential, allocated at ISSUE time — same
   *  numbering port/strategy as `InvoiceNumberAllocator`, a distinct
   *  series (e.g. "CN-2026-000045") so credit-note and invoice numbers
   *  never collide or share a counter. */
  creditNoteNumber: string | null;
  status: CreditNoteStatusValue;

  originalInvoiceId: string;
  /** Denormalized from the original invoice at creation time so a
   *  credit note remains fully readable even if the original invoice
   *  record were ever archived — same "immutable snapshot" reasoning as
   *  `InvoiceRecord` itself. */
  professionalProfileId: string | null;
  companyProfileId: string | null;

  reason: string;
  /** Idempotency key supplied by the caller (see
   *  `CreateCreditNoteUseCase`'s own doc comment) — unique per original
   *  invoice, so a retried request for "the same correction" converges
   *  on the same credit note rather than creating a duplicate. */
  idempotencyKey: string;

  issueDate: Date | null;
  currency: string;
  lineItems: CreditNoteLineItemRecord[];

  // --- Corrected/reversed financial amounts — derived via Module 78's
  //     `calculateTaxReversal`, never independently recalculated. ---
  reversedTaxableBase: number;
  reversedVatRateBps: number;
  reversedVatAmount: number;
  reversedCommissionAmount: number;
  reversedIrpfWithholdingAmount: number;
  totalAmount: number;

  documentHash: string | null;

  cancelledAt: Date | null;
  cancelledByUserId: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreditNoteLineItemInput {
  description: string;
  amount: number;
}

export interface CreateCreditNoteData {
  originalInvoiceId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  reason: string;
  idempotencyKey: string;
  currency: string;
  lineItems: CreditNoteLineItemInput[];
  reversedTaxableBase: number;
  reversedVatRateBps: number;
  reversedVatAmount: number;
  reversedCommissionAmount: number;
  reversedIrpfWithholdingAmount: number;
  totalAmount: number;
}

export interface IssueCreditNoteData {
  id: string;
  creditNoteNumber: string;
  issueDate: Date;
  documentHash: string;
}

export interface CreditNoteRepository {
  findById(id: string): Promise<CreditNoteRecord | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<CreditNoteRecord | null>;
  listByOriginalInvoiceId(originalInvoiceId: string): Promise<CreditNoteRecord[]>;

  /** Sum of `totalAmount` across every non-CANCELLED credit note already
   *  issued/drafted against `originalInvoiceId` — the figure
   *  `domain/services/credit-note-eligibility.ts` compares a new request
   *  against. Computed by the repository (a single aggregate query) so
   *  the use case never has to load every prior credit note into memory
   *  to sum them itself. */
  sumCreditedAmountForInvoice(originalInvoiceId: string): Promise<number>;

  /** Insert-or-return-existing keyed by `idempotencyKey` — a retried
   *  "create credit note" request (network retry, duplicate button
   *  click) converges on the exact same row rather than creating a
   *  second credit note, backed by a DB-level unique constraint on
   *  `idempotencyKey` (same layered idempotency strategy as
   *  `PayoutRepository.createPending`'s unique `jobId`). */
  createOrGetExisting(data: CreateCreditNoteData): Promise<CreditNoteRecord>;

  /** DRAFT -> ISSUED. */
  issue(data: IssueCreditNoteData): Promise<CreditNoteRecord>;
}
