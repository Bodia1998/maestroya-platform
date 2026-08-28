import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by `IssueInvoiceUseCase`
 * the moment an invoice becomes ISSUED (immutable, numbered) — the exact
 * signal Module 76's payout-eligibility gate
 * (`CheckInvoiceRequiredForPayoutUseCase`) is satisfied by, mirroring how
 * `PaymentReleaseApproved` (Module 66) is documented as "the exact signal
 * a future payout module is expected to subscribe to."
 */
export class InvoiceIssued extends DomainEvent {
  static readonly eventName = "invoicing.invoice-issued";

  constructor(
    readonly invoiceId: string,
    readonly jobId: string,
    readonly invoiceNumber: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly totalAmount: number,
    readonly currency: string,
  ) {
    super();
  }
}
