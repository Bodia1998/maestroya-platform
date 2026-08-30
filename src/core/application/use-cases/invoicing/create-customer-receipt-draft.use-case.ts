import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { InvoiceLineItemInput, InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { MAESTROYA_ISSUER_LEGAL_NAME, MAESTROYA_ISSUER_TAX_ID } from "@/domain/services/invoicing-issuer";
import type { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoiceCreated } from "@/domain/events/invoice-created";

const CUSTOMER_RECEIPT_RECIPIENT_FALLBACK_NAME = "Cliente";

/**
 * Module 85 — Invoicing & Credit Note Activation.
 *
 * Creates the DRAFT customer-facing receipt (`InvoiceType.CUSTOMER_RECEIPT`)
 * for a completed, paid Job — the "genuine customer-facing invoice/receipt
 * type" the module brief requires, closing the B4 gap that Module 79 only
 * ever produced the professional's own self-billed invoice, never anything
 * the actual paying customer receives. Deliberately mirrors
 * `CreateProfessionalInvoiceDraftUseCase`'s own shape (same preconditions,
 * same "never recalculate tax, always read `CalculateJobTaxBreakdownUseCase`"
 * posture, same idempotency-by-`findByJobId` convention adapted to its own
 * per-Job-per-type uniqueness — see this class's own "at most one" note)
 * rather than inventing a second flow.
 *
 * ## Not self-billing
 * A `CUSTOMER_RECEIPT` has no `SelfBillingAuthorizationRecord` and never
 * goes through the PENDING_ACCEPTANCE/ACCEPTED electronic-acceptance
 * steps `PROFESSIONAL_SELF_BILLED` requires — the customer already paid;
 * there is nothing for them to "accept." It is issued directly from DRAFT
 * — see `domain/services/invoice-lifecycle.ts`'s own `issuableFromStatus`
 * and `IssueInvoiceUseCase`, reused unchanged for both invoice types.
 *
 * ## Line items — the one deliberate difference from the professional invoice
 * `CreateProfessionalInvoiceDraftUseCase` excludes a `CUSTOMER_PURCHASED`
 * quote's MATERIALS line (never commissionable/taxable revenue for the
 * professional's own invoice — see that class's own doc comment). A
 * customer receipt shows the customer everything they were actually
 * charged for, including materials they purchased through the platform,
 * so this use case does NOT apply that filter — every `QuoteItem` is
 * included verbatim.
 *
 * ## Idempotency
 * `InvoiceRepository.findByJobId` returns the most recent non-CANCELLED
 * invoice for a Job regardless of `type` — since a `CUSTOMER_RECEIPT` and
 * a `PROFESSIONAL_SELF_BILLED` invoice for the same Job are two distinct
 * documents, this use case narrows that lookup to rows of its own type
 * before deciding whether one already exists, mirroring
 * `CreateProfessionalInvoiceDraftUseCase`'s own "return the existing DRAFT
 * unchanged; refuse a second draft once one has progressed" rule, scoped
 * to `CUSTOMER_RECEIPT` rows only.
 */
export class CreateCustomerReceiptDraftUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly payments: PaymentRepository,
    private readonly quotes: QuoteRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly users: UserRepository,
    private readonly invoices: InvoiceRepository,
    private readonly taxBreakdowns: CalculateJobTaxBreakdownUseCase,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(jobId: string): Promise<InvoiceRecord> {
    const existing = await this.invoices.findByJobIdAndType(jobId, "CUSTOMER_RECEIPT");
    if (existing) {
      if (existing.status === "DRAFT") return existing;
      throw new ValidationError(
        `A customer receipt already exists for this job (status ${existing.status}) — a new draft cannot be created.`,
      );
    }

    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }
    if (job.status !== "COMPLETED") {
      throw new ValidationError("A customer receipt can only be drafted once the job is COMPLETED.");
    }

    const paymentsForJob = await this.payments.findByJobId(jobId);
    const payment = paymentsForJob.find((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") ?? null;
    if (!payment) {
      throw new ValidationError("A customer receipt can only be drafted once the customer's payment has been captured.");
    }

    const quote = await this.quotes.findById(job.quoteId);
    if (!quote) {
      throw new NotFoundError("Quote", job.quoteId);
    }

    const recipient = await this.resolveRecipientLegalName(job.customerId);

    const lineItems: InvoiceLineItemInput[] = quote.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      category: item.category,
    }));

    const breakdown = await this.taxBreakdowns.execute(jobId);

    const invoice = await this.invoices.createDraft({
      type: "CUSTOMER_RECEIPT",
      jobId,
      quoteId: quote.id,
      paymentId: payment.id,
      professionalProfileId: job.professionalProfileId,
      companyProfileId: job.companyProfileId,
      customerId: job.customerId,
      issuerLegalName: MAESTROYA_ISSUER_LEGAL_NAME,
      issuerTaxId: MAESTROYA_ISSUER_TAX_ID,
      recipientLegalName: recipient,
      recipientTaxId: null,
      selfBillingAuthorizationId: null,
      invoiceDate: new Date(),
      currency: payment.currency,
      lineItems,
      taxableBase: breakdown.customerTaxableBase,
      vatRateBps: breakdown.customerVatRateBps,
      vatAmount: breakdown.customerVatAmount,
      // A customer receipt bills the customer's own gross total — never
      // MaestroYa's commission or the professional's IRPF withholding,
      // both of which are internal-to-the-platform figures the customer
      // never sees on their own receipt. Explicitly zeroed (never
      // omitted) so every persisted Invoice row always has every
      // financial field populated, matching `PROFESSIONAL_SELF_BILLED`'s
      // own invariant.
      commissionBase: 0,
      commissionRateBps: 0,
      commissionAmount: 0,
      irpfWithholdingRateBps: 0,
      irpfWithholdingAmount: 0,
      totalAmount: breakdown.customerGrossTotal,
    });

    await publishDomainEvent(
      this.eventBus,
      new InvoiceCreated(invoice.id, jobId, invoice.professionalProfileId, invoice.companyProfileId, invoice.totalAmount, invoice.currency),
      this.failureReporter,
    );

    return invoice;
  }

  /** Best-effort legal-name resolution for the receipt's recipient — a
   *  `CustomerProfile` has no legal-name/tax-ID field of its own (see
   *  that repository's own doc comment); Spanish "factura simplificada"
   *  rules do not require a full tax ID for a consumer-facing receipt at
   *  this transaction size, so this never blocks receipt creation on a
   *  missing one — falls back to a generic recipient label rather than
   *  throwing, mirroring how `CreateProfessionalInvoiceDraftUseCase`
   *  already falls back to "—" for a professional with no business name. */
  private async resolveRecipientLegalName(customerId: string): Promise<string> {
    const customerProfile = await this.customerProfiles.findById(customerId);
    if (!customerProfile) return CUSTOMER_RECEIPT_RECIPIENT_FALLBACK_NAME;
    const user = await this.users.findById(customerProfile.userId);
    return user?.name?.trim() || CUSTOMER_RECEIPT_RECIPIENT_FALLBACK_NAME;
  }
}
