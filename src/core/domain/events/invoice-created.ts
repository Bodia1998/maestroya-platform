import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by
 * `CreateProfessionalInvoiceDraftUseCase` when a new DRAFT invoice is
 * created for a Job.
 */
export class InvoiceCreated extends DomainEvent {
  static readonly eventName = "invoicing.invoice-created";

  constructor(
    readonly invoiceId: string,
    readonly jobId: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly totalAmount: number,
    readonly currency: string,
  ) {
    super();
  }
}
