import { InvalidInvoiceTransitionError, IssuerTaxIdNotConfiguredError, NotFoundError } from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import { issuableFromStatus } from "@/domain/services/invoice-lifecycle";
import { computeDocumentHash } from "@/domain/services/invoice-document";
import { isPlaceholderIssuerTaxId } from "@/domain/services/invoicing-issuer";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoiceIssued } from "@/domain/events/invoice-issued";

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * ACCEPTED -> ISSUED for a `PROFESSIONAL_SELF_BILLED` invoice, DRAFT ->
 * ISSUED for a `CUSTOMER_RECEIPT` (Module 85 — see
 * `domain/services/invoice-lifecycle.ts`'s own `issuableFromStatus`): the
 * transition that makes an invoice immutable and numbered (see the module
 * brief's "DOCUMENT IMMUTABILITY" and "NUMBERING" sections).
 *
 * ## Numbering (Module 85 fix)
 * The invoice number is allocated by `InvoiceRepository.issue` itself,
 * INSIDE the same database transaction as the compare-and-swap status
 * write — never by this use case calling `InvoiceNumberAllocator`
 * directly beforehand. Module 79 originally allocated the number here,
 * then called `issue()` as a separate step; if that second step lost a
 * race (the invoice had already been issued/cancelled by a concurrent or
 * duplicate call), the allocated number was permanently burned with no
 * invoice ever attached to it — a silent gap in a legally-sequential
 * numbering series. Coupling the two in one transaction means a lost
 * race rolls the allocation back too. This use case supplies the
 * repository a `buildDocumentHash` callback (a pure function of the
 * about-to-be-allocated number) rather than precomputing the hash itself,
 * since the number no longer exists until the repository's own
 * transaction allocates it.
 *
 * ## Issuer tax ID guard (Module 85)
 * Refuses to issue while the invoice's own `issuerTaxId` snapshot is
 * still MaestroYa's unconfirmed placeholder (see
 * `domain/services/invoicing-issuer.ts`) — a legally invalid document
 * must never be numbered, hashed, or persisted as ISSUED. See
 * `IssuerTaxIdNotConfiguredError`.
 *
 * Once this method returns successfully, no financial field, party, line
 * item, or the invoice number itself can ever be changed by any other use
 * case in this module — `InvoiceRepository` exposes no method that could.
 */
export class IssueInvoiceUseCase {
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

    const requiredFromStatus = issuableFromStatus(invoice.type);
    if (invoice.status !== requiredFromStatus) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} cannot move from ${invoice.status} to ISSUED — a ${invoice.type} invoice must be ${requiredFromStatus} first.`,
      );
    }

    if (isPlaceholderIssuerTaxId(invoice.issuerTaxId)) {
      throw new IssuerTaxIdNotConfiguredError();
    }

    const issueDate = new Date();

    const { applied, record } = await this.invoices.issue({
      id: invoiceId,
      issueDate,
      buildDocumentHash: (invoiceNumber) =>
        computeDocumentHash({
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
        }),
      fromStatuses: [requiredFromStatus],
    });
    if (!applied) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} is no longer ${requiredFromStatus} (now ${record.status}) — the issue transition lost a race or was already applied.`,
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
