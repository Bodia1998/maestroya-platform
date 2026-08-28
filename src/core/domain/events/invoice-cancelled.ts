import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised when a DRAFT/
 * PENDING_ACCEPTANCE invoice is cancelled — never raised for an ISSUED/
 * PAID invoice, which cannot be cancelled (see `invoice-lifecycle.ts`).
 */
export class InvoiceCancelled extends DomainEvent {
  static readonly eventName = "invoicing.invoice-cancelled";

  constructor(
    readonly invoiceId: string,
    readonly jobId: string,
    readonly reason: string,
    readonly cancelledByUserId: string,
  ) {
    super();
  }
}
