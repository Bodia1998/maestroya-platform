import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by `AcceptInvoiceUseCase`
 * on the PENDING_ACCEPTANCE -> ACCEPTED transition. Carries the
 * acceptance evidence fields (never the raw IP/user-agent — see
 * `SelfBillingAuthorizationRecord`'s own doc comment on why those stay
 * out of anything broadcast further than the audit log) so downstream
 * modules (e.g. Module 76's payout-eligibility gate) can react without a
 * second read of the Invoice.
 */
export class InvoiceAccepted extends DomainEvent {
  static readonly eventName = "invoicing.invoice-accepted";

  constructor(
    readonly invoiceId: string,
    readonly jobId: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly acceptedByUserId: string,
    readonly acceptedAt: Date,
    readonly agreementVersion: string,
  ) {
    super();
  }
}
