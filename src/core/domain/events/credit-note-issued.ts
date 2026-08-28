import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by
 * `CreateCreditNoteUseCase` once the credit note has been numbered and
 * marked ISSUED — the document is now the final, immutable correction
 * record for its original invoice.
 */
export class CreditNoteIssued extends DomainEvent {
  static readonly eventName = "invoicing.credit-note-issued";

  constructor(
    readonly creditNoteId: string,
    readonly creditNoteNumber: string,
    readonly originalInvoiceId: string,
    readonly totalAmount: number,
  ) {
    super();
  }
}
