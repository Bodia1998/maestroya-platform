import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by `MarkInvoicePaidUseCase`
 * on the ISSUED -> PAID transition — recorded once the professional's
 * payout for this invoice's Job has actually settled (see
 * `ExecuteProfessionalPayoutUseCase`'s `ProfessionalPayoutExecuted`,
 * which this use case subscribes to).
 */
export class InvoicePaid extends DomainEvent {
  static readonly eventName = "invoicing.invoice-paid";

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
