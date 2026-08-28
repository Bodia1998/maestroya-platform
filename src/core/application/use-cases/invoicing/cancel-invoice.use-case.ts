import { InvalidInvoiceTransitionError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import { canTransitionInvoiceStatus } from "@/domain/services/invoice-lifecycle";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoiceCancelled } from "@/domain/events/invoice-cancelled";

/**
 * Module 79 — Invoicing & Credit Notes: DRAFT/PENDING_ACCEPTANCE ->
 * CANCELLED. Never reachable once ACCEPTED or later — see
 * `invoice-lifecycle.ts`'s own transition table. Used for the "the
 * professional never actually registered for self-billing after all" or
 * "the underlying job/payment turned out to be invalid" cases; an
 * ISSUED invoice is corrected via a credit note instead, never cancelled.
 */
export class CancelInvoiceUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(invoiceId: string, cancelledByUserId: string, reason: string): Promise<InvoiceRecord> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundError("Invoice", invoiceId);
    }
    if (!reason.trim()) {
      throw new ValidationError("A cancellation reason is required.");
    }
    if (!canTransitionInvoiceStatus(invoice.status, "CANCELLED")) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} cannot be cancelled from status ${invoice.status} — only a DRAFT or PENDING_ACCEPTANCE invoice may be cancelled; an ISSUED invoice must be corrected with a credit note instead.`,
      );
    }

    const cancelledAt = new Date();
    const { applied, record } = await this.invoices.cancel({
      id: invoiceId,
      cancelledByUserId,
      cancelledAt,
      reason,
      fromStatuses: ["DRAFT", "PENDING_ACCEPTANCE"],
    });
    if (!applied) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} is no longer cancellable (now ${record.status}) — the cancellation transition lost a race.`,
      );
    }

    await publishDomainEvent(this.eventBus, new InvoiceCancelled(record.id, record.jobId, reason, cancelledByUserId), this.failureReporter);

    return record;
  }
}
