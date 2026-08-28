import { InvalidInvoiceTransitionError, NotFoundError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import { canTransitionInvoiceStatus } from "@/domain/services/invoice-lifecycle";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoiceSubmittedForAcceptance } from "@/domain/events/invoice-submitted-for-acceptance";

/**
 * Module 79 — Invoicing & Credit Notes: DRAFT -> PENDING_ACCEPTANCE. The
 * one place `canTransitionInvoiceStatus` is consulted before this
 * transition — never re-implemented inline.
 */
export class SubmitInvoiceForAcceptanceUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(invoiceId: string): Promise<InvoiceRecord> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundError("Invoice", invoiceId);
    }
    if (!canTransitionInvoiceStatus(invoice.status, "PENDING_ACCEPTANCE")) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} cannot move from ${invoice.status} to PENDING_ACCEPTANCE.`,
      );
    }

    const { applied, record } = await this.invoices.submitForAcceptance(invoiceId, ["DRAFT"]);
    if (!applied) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} is no longer DRAFT (now ${record.status}) — the submit-for-acceptance transition lost a race or was already applied.`,
      );
    }

    await publishDomainEvent(
      this.eventBus,
      new InvoiceSubmittedForAcceptance(record.id, record.jobId, record.professionalProfileId, record.companyProfileId),
      this.failureReporter,
    );

    return record;
  }
}
