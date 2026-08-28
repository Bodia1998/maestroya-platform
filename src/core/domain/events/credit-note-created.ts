import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by
 * `CreateCreditNoteUseCase` when a new (DRAFT, not-yet-numbered) credit
 * note is created against an ISSUED/PAID invoice.
 */
export class CreditNoteCreated extends DomainEvent {
  static readonly eventName = "invoicing.credit-note-created";

  constructor(
    readonly creditNoteId: string,
    readonly originalInvoiceId: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly totalAmount: number,
    readonly reason: string,
  ) {
    super();
  }
}
