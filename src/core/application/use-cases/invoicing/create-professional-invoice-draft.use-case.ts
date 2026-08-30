import { NotFoundError, SelfBillingNotAuthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { InvoiceLineItemInput, InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { SelfBillingAuthorizationRepository } from "@/domain/repositories/self-billing-authorization-repository";
import { isSelfBillingAuthorized } from "@/domain/services/self-billing-authorization-rules";
import { MAESTROYA_ISSUER_LEGAL_NAME, MAESTROYA_ISSUER_TAX_ID } from "@/domain/services/invoicing-issuer";
import type { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoiceCreated } from "@/domain/events/invoice-created";

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * Creates the DRAFT professional self-billed invoice for a completed,
 * paid Job — the exact flow the module brief describes: "customer accepts
 * quote -> service completed -> customer payment captured -> MaestroYa
 * calculates the professional amount -> MaestroYa prepares the
 * professional invoice."
 *
 * ## Never recalculates tax/commission
 * Every financial figure comes from `CalculateJobTaxBreakdownUseCase`
 * (Module 78) — this use case never re-derives IVA, commission, or the
 * professional's net base itself. It IS responsible for one thing Module
 * 78 does not do: turning the Job's Quote line items into the invoice's
 * own line-item SNAPSHOT, applying the exact same Scenario A/B materials
 * filter `CalculateJobTaxBreakdownUseCase` already applies internally (a
 * `CUSTOMER_PURCHASED` quote's materials are never commissionable/taxable
 * — see that use case's own doc comment) — so a professional's invoice
 * line items and its totals can never disagree about which materials
 * were included. This is a small, duplicated FILTER (which Quote items to
 * show), never a duplicated CALCULATION (how to tax/commission them).
 *
 * ## Self-billing gate
 * Throws `SelfBillingNotAuthorizedError` unless the Job's
 * professional/company currently holds an ACTIVE
 * `SelfBillingAuthorizationRecord` — see the module brief's "Do not
 * assume that every professional automatically has self-billing
 * authorization."
 *
 * ## Idempotency
 * At most one non-CANCELLED invoice per Job (see
 * `InvoiceRepository.createDraft`'s own doc comment and the migration's
 * partial unique index) — this use case checks `findByJobId` first and
 * returns the existing invoice unchanged if one is already DRAFT (a
 * retried request), and throws `ValidationError` if one already exists in
 * any later status (creating a second draft for the same Job once one has
 * progressed is a defect, not a retry).
 */
export class CreateProfessionalInvoiceDraftUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly payments: PaymentRepository,
    private readonly quotes: QuoteRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companies: CompanyRepository,
    private readonly selfBillingAuthorizations: SelfBillingAuthorizationRepository,
    private readonly invoices: InvoiceRepository,
    private readonly taxBreakdowns: CalculateJobTaxBreakdownUseCase,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(jobId: string): Promise<InvoiceRecord> {
    const existing = await this.invoices.findByJobId(jobId);
    if (existing) {
      if (existing.status === "DRAFT") return existing;
      throw new ValidationError(
        `An invoice already exists for this job (status ${existing.status}) — a new draft cannot be created.`,
      );
    }

    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }
    if (job.status !== "COMPLETED") {
      throw new ValidationError("An invoice can only be drafted once the job is COMPLETED.");
    }

    const paymentsForJob = await this.payments.findByJobId(jobId);
    const payment = paymentsForJob.find((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") ?? null;
    if (!payment) {
      throw new ValidationError("An invoice can only be drafted once the customer's payment has been captured.");
    }

    const quote = await this.quotes.findById(job.quoteId);
    if (!quote) {
      throw new NotFoundError("Quote", job.quoteId);
    }

    const owner = job.professionalProfileId
      ? ({ type: "PROFESSIONAL", id: job.professionalProfileId } as const)
      : job.companyProfileId
        ? ({ type: "COMPANY", id: job.companyProfileId } as const)
        : null;
    if (!owner) {
      throw new ValidationError("This job has neither a professional nor a company assigned — cannot draft an invoice.");
    }

    const authorization =
      owner.type === "PROFESSIONAL"
        ? await this.selfBillingAuthorizations.findActiveForProfessional(owner.id)
        : await this.selfBillingAuthorizations.findActiveForCompany(owner.id);
    if (!isSelfBillingAuthorized(authorization)) {
      throw new SelfBillingNotAuthorizedError();
    }

    const recipient =
      owner.type === "PROFESSIONAL"
        ? await this.professionals.findById(owner.id)
        : await this.companies.findById(owner.id);
    if (!recipient) {
      throw new NotFoundError(owner.type === "PROFESSIONAL" ? "ProfessionalProfile" : "CompanyProfile", owner.id);
    }
    const recipientLegalName =
      owner.type === "PROFESSIONAL"
        ? (recipient as { businessName: string | null }).businessName ?? "—"
        : (recipient as { legalName: string }).legalName;
    const recipientTaxId = (recipient as { taxId: string | null }).taxId ?? null;

    // Same Scenario A/B filter CalculateJobTaxBreakdownUseCase applies —
    // see this file's own doc comment. Never includes a CUSTOMER_PURCHASED
    // MATERIALS item on the professional's invoice.
    const lineItems: InvoiceLineItemInput[] = quote.items
      .filter((item) => item.category !== "MATERIALS" || quote.materialsStrategy === "PROFESSIONAL_SUPPLIED")
      .map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        category: item.category,
      }));

    const breakdown = await this.taxBreakdowns.execute(jobId);

    const invoice = await this.invoices.createDraft({
      type: "PROFESSIONAL_SELF_BILLED",
      jobId,
      quoteId: quote.id,
      paymentId: payment.id,
      professionalProfileId: owner.type === "PROFESSIONAL" ? owner.id : null,
      companyProfileId: owner.type === "COMPANY" ? owner.id : null,
      customerId: job.customerId,
      issuerLegalName: MAESTROYA_ISSUER_LEGAL_NAME,
      issuerTaxId: MAESTROYA_ISSUER_TAX_ID,
      recipientLegalName,
      recipientTaxId,
      selfBillingAuthorizationId: authorization!.id,
      invoiceDate: new Date(),
      currency: payment.currency,
      lineItems,
      taxableBase: breakdown.professionalNetBase,
      vatRateBps: breakdown.professionalVatRateBps,
      vatAmount: breakdown.professionalVatAmount,
      commissionBase: breakdown.commissionBase,
      commissionRateBps: breakdown.commissionRateBps,
      commissionAmount: breakdown.commissionAmount,
      irpfWithholdingRateBps: breakdown.irpfWithholdingRateBps,
      irpfWithholdingAmount: breakdown.irpfWithholdingAmount,
      totalAmount: breakdown.professionalInvoiceGrossTotal,
    });

    await publishDomainEvent(
      this.eventBus,
      new InvoiceCreated(invoice.id, jobId, invoice.professionalProfileId, invoice.companyProfileId, invoice.totalAmount, invoice.currency),
      this.failureReporter,
    );

    return invoice;
  }
}
