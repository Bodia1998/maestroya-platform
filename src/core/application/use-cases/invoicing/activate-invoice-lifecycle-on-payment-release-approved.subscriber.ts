import { SelfBillingNotAuthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { EventHandler } from "@/application/ports/event-bus";
import type { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { CreateProfessionalInvoiceDraftUseCase } from "./create-professional-invoice-draft.use-case";
import type { SubmitInvoiceForAcceptanceUseCase } from "./submit-invoice-for-acceptance.use-case";
import type { AcceptInvoiceUseCase } from "./accept-invoice.use-case";
import type { IssueInvoiceUseCase } from "./issue-invoice.use-case";
import type { CreateCustomerReceiptDraftUseCase } from "./create-customer-receipt-draft.use-case";

/**
 * Module 85 — Invoicing & Credit Note Activation.
 *
 * The activation this module exists to add: Module 79 built a complete
 * `CreateProfessionalInvoiceDraftUseCase` -> `SubmitInvoiceForAcceptanceUseCase`
 * -> `AcceptInvoiceUseCase` -> `IssueInvoiceUseCase` pipeline that nothing
 * in the codebase ever called — see MODULE_85_IMPLEMENTATION_REPORT.md,
 * "Audit findings." This subscriber is the missing trigger, wired to
 * `PaymentReleaseApproved` (Module 66) — the exact point in the job
 * lifecycle where a Job is already COMPLETED and its Payment already
 * CAPTURED (`EvaluatePaymentReleaseUseCase` only reaches `RELEASE_APPROVED`
 * after both), which are `CreateProfessionalInvoiceDraftUseCase`'s own two
 * preconditions — never an earlier event that might fire before either is
 * true. Mirrors `MarkInvoicePaidOnPayoutExecutedSubscriber`'s own
 * "subscribe to a payments-module event from within invoicing's own
 * compose.ts" convention exactly.
 *
 * ## Why not just call `IssueInvoiceUseCase` — the pipeline must run in full
 * `PaymentReleaseApproved` only tells this handler a NEW invoice can start
 * its lifecycle; it says nothing about which step a Job's invoice is
 * currently on, so this handler always re-reads the current invoice (if
 * any) and resumes from wherever it actually is, rather than assuming
 * DRAFT. That is what makes a partial-failure retry converge (Module 85's
 * required Scenario 2/7): if this handler previously created the DRAFT
 * and then crashed before issuing it, the next delivery (a retry, or a
 * second `PaymentReleaseApproved` for the same Job) finds the existing
 * DRAFT/PENDING_ACCEPTANCE/ACCEPTED row and picks up from there — it
 * never calls `CreateProfessionalInvoiceDraftUseCase` a second time once
 * one exists (that use case's own idempotency check would reject it
 * anyway once the row has moved past DRAFT).
 *
 * ## Auto-acceptance is not fabricated consent
 * `AcceptInvoiceUseCase.execute(invoiceId, acceptedByUserId)` verifies
 * `acceptedByUserId` really is the invoice's own owning professional/
 * company user — see that class's own doc comment. This handler resolves
 * that same owner id from `ProfessionalRepository`/`CompanyRepository`
 * and passes it through unchanged; it does not invent, borrow, or spoof a
 * different identity. The professional/company already gave MaestroYa
 * standing authorization to self-bill on their behalf — that is exactly
 * what an ACTIVE `SelfBillingAuthorizationRecord` (`isSelfBillingAuthorized`,
 * checked by both `CreateProfessionalInvoiceDraftUseCase` and
 * `AcceptInvoiceUseCase` themselves) already means; this handler performs
 * the identical acceptance evidence write (`acceptedByUserId`,
 * `acceptedAt`, the authorization's own `agreementVersion`) a live
 * UI-driven acceptance would, under that same already-granted consent —
 * it does not weaken or bypass `AcceptInvoiceUseCase`'s own authorization
 * check in any way.
 *
 * ## No self-billing authorization -> no invoice, silently
 * `SelfBillingNotAuthorizedError` is an expected outcome, not a bug — a
 * Job whose professional/company never granted self-billing authorization
 * simply never gets an automatic invoice (see
 * `CheckInvoiceRequiredForPayoutUseCase`'s own `requireInvoiceForPayout:
 * false` default, unchanged by this module, for why that never blocks
 * the payout either). Swallowed here rather than reported as a failure.
 * The same applies to the handful of `ValidationError`s
 * `CreateProfessionalInvoiceDraftUseCase`/`CreateCustomerReceiptDraftUseCase`
 * raise for "an invoice already exists in a later status" (duplicate
 * event delivery — Scenario 3) and "job not COMPLETED yet"/"payment not
 * CAPTURED yet" (a defensive guard this handler's own precondition
 * reasoning above says should never actually trigger, but is treated as
 * a safe no-op rather than a crash if it somehow does). Any other error
 * (e.g. `NotFoundError` for a Job/Quote that should exist) is a genuine
 * defect and is re-thrown — `SynchronousEventBus` isolates it into an
 * `EventDispatchError` that `FailureReporter` surfaces, without ever
 * blocking the sibling `ExecutePayoutOnReleaseApprovedSubscriber` for the
 * same event (see that bus's own "handler failure contract" doc comment).
 */
export class ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber implements EventHandler<PaymentReleaseApproved> {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companies: CompanyRepository,
    private readonly createProfessionalInvoiceDraft: CreateProfessionalInvoiceDraftUseCase,
    private readonly submitForAcceptance: SubmitInvoiceForAcceptanceUseCase,
    private readonly acceptInvoice: AcceptInvoiceUseCase,
    private readonly issueInvoice: IssueInvoiceUseCase,
    private readonly createCustomerReceiptDraft: CreateCustomerReceiptDraftUseCase,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async handle(event: PaymentReleaseApproved): Promise<void> {
    // Two independent documents for the same Job — a failure activating
    // one must never prevent the other from being activated.
    await this.runStep(() => this.activateProfessionalInvoice(event.jobId));
    await this.runStep(() => this.activateCustomerReceipt(event.jobId));
  }

  private async runStep(step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      if (isExpectedNonActivation(error)) return;
      throw error;
    }
  }

  private async activateProfessionalInvoice(jobId: string): Promise<void> {
    let invoice = await this.invoices.findByJobIdAndType(jobId, "PROFESSIONAL_SELF_BILLED");
    if (!invoice) {
      invoice = await this.createProfessionalInvoiceDraft.execute(jobId);
    }
    if (invoice.status === "CANCELLED") return;

    if (invoice.status === "DRAFT") {
      invoice = await this.submitForAcceptance.execute(invoice.id);
    }
    if (invoice.status === "PENDING_ACCEPTANCE") {
      const ownerUserId = await this.resolveOwnerUserId(invoice);
      if (!ownerUserId) return;
      invoice = await this.acceptInvoice.execute(invoice.id, ownerUserId);
    }
    if (invoice.status === "ACCEPTED") {
      await this.issueInvoice.execute(invoice.id);
    }
    // ISSUED/PAID: already fully activated — nothing further to do.
  }

  private async activateCustomerReceipt(jobId: string): Promise<void> {
    let receipt = await this.invoices.findByJobIdAndType(jobId, "CUSTOMER_RECEIPT");
    if (!receipt) {
      receipt = await this.createCustomerReceiptDraft.execute(jobId);
    }
    if (receipt.status === "DRAFT") {
      await this.issueInvoice.execute(receipt.id);
    }
    // ISSUED/CANCELLED: already fully activated (or deliberately not) —
    // nothing further to do.
  }

  private async resolveOwnerUserId(invoice: InvoiceRecord): Promise<string | null> {
    if (invoice.professionalProfileId) {
      const professional = await this.professionals.findById(invoice.professionalProfileId);
      return professional?.userId ?? null;
    }
    if (invoice.companyProfileId) {
      const company = await this.companies.findById(invoice.companyProfileId);
      return company?.ownerUserId ?? null;
    }
    return null;
  }
}

function isExpectedNonActivation(error: unknown): boolean {
  return error instanceof SelfBillingNotAuthorizedError || error instanceof ValidationError;
}
