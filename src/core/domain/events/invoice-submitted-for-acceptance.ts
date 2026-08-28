import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by
 * `SubmitInvoiceForAcceptanceUseCase` on the DRAFT -> PENDING_ACCEPTANCE
 * transition — the signal a notification subscriber uses to tell the
 * professional their invoice is ready for review.
 */
export class InvoiceSubmittedForAcceptance extends DomainEvent {
  static readonly eventName = "invoicing.invoice-submitted-for-acceptance";

  constructor(
    readonly invoiceId: string,
    readonly jobId: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
  ) {
    super();
  }
}
