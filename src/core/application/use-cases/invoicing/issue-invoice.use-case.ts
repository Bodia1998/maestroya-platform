import { InvalidInvoiceTransitionError, NotFoundError } from "@/domain/errors/domain-error";
import type { InvoiceNumberAllocator, InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import { canTransitionInvoiceStatus } from "@/domain/services/invoice-lifecycle";
import { computeDocumentHash } from "@/domain/services/invoice-document";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoiceIssued } from "@/domain/events/invoice-issued";

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * ACCEPTED -> ISSUED: the transition that makes an invoice immutable and
 * numbered (see the module brief's "DOCUMENT IMMUTABILITY" and
 * "NUMBERING" sections). The invoice number is allocated here, and only
 * here — never at DRAFT creation — via the concurrency-safe
 * `InvoiceNumberAllocator` port (see that interface's own doc comment for
 * why it is never derived from a timestamp or a database id). Once this
 * method returns successfully, no financial field, party, line item, or
 * the invoice number itself can ever be changed by any other use case in
 * this module — `InvoiceRepository` exposes no method that could.
 */
export class IssueInvoiceUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly numberAllocator: InvoiceNumberAllocator,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(invoiceId: string): Promise<InvoiceRecord> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundError("Invoice", invoiceId);
    }
    if (!canTransitionInvoiceStatus(invoice.status, "ISSUED")) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} cannot move from ${invoice.status} to ISSUED — only an ACCEPTED invoice may be issued.`,
      );
    }

    const issueDate = new Date();
    const invoiceNumber = await this.numberAllocator.allocateNextInvoiceNumber(issueDate.getUTCFullYear());

    const documentHash = computeDocumentHash({
      invoiceId: invoice.id,
      invoiceNumber,
      jobId: invoice.jobId,
      professionalProfileId: invoice.professionalProfileId,
      companyProfileId: invoice.companyProfileId,
      currency: invoice.currency,
      lineItems: invoice.lineItems,
      taxableBase: invoice.taxableBase,
      vatRateBps: invoice.vatRateBps,
      vatAmount: invoice.vatAmount,
      commissionBase: invoice.commissionBase,
      commissionRateBps: invoice.commissionRateBps,
      commissionAmount: invoice.commissionAmount,
      irpfWithholdingRateBps: invoice.irpfWithholdingRateBps,
      irpfWithholdingAmount: invoice.irpfWithholdingAmount,
      totalAmount: invoice.totalAmount,
      acceptedAt: invoice.acceptedAt?.toISOString() ?? null,
      acceptedByUserId: invoice.acceptedByUserId,
    });

    const { applied, record } = await this.invoices.issue({
      id: invoiceId,
      invoiceNumber,
      issueDate,
      documentHash,
      fromStatuses: ["ACCEPTED"],
    });
    if (!applied) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} is no longer ACCEPTED (now ${record.status}) — the issue transition lost a race or was already applied.`,
      );
    }

    await publishDomainEvent(
      this.eventBus,
      new InvoiceIssued(record.id, record.jobId, record.invoiceNumber as string, record.professionalProfileId, record.companyProfileId, record.totalAmount, record.currency),
      this.failureReporter,
    );

    return record;
  }
}
