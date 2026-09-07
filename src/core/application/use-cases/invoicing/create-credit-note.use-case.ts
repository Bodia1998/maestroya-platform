import { NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { CreditNoteRecord, CreditNoteRepository } from "@/domain/repositories/credit-note-repository";
import type { InvoiceRepository } from "@/domain/repositories/invoice-repository";
import { isCreditableInvoiceStatus } from "@/domain/services/invoice-lifecycle";
import { assertCreditNoteWithinRemainingAmount, computeRemainingCreditableAmount } from "@/domain/services/credit-note-eligibility";
import { computeDocumentHash } from "@/domain/services/invoice-document";
import { roundToCents } from "@/domain/services/money";
import { calculateTaxReversal } from "@/domain/services/maestroya-tax-calculation-service";
import type { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { CreditNoteCreated } from "@/domain/events/credit-note-created";
import { CreditNoteIssued } from "@/domain/events/credit-note-issued";

export interface CreateCreditNoteInput {
  originalInvoiceId: string;
  /** The amount (gross, in the invoice's own currency) to credit against
   *  the professional's invoice total. Omit for a full credit of
   *  whatever remains creditable. */
  requestedAmount?: number;
  reason: string;
  /** Caller-supplied idempotency key — see
   *  `CreditNoteRepository.createOrGetExisting`'s own doc comment. A
   *  retried request with the SAME key is guaranteed to converge on the
   *  same credit note rather than creating a duplicate. */
  idempotencyKey: string;
  /** Ownership check: must match the original invoice's own
   *  professionalProfileId/companyProfileId — see this class's own doc
   *  comment on why an unrelated party can never credit-note someone
   *  else's invoice. `null` only for an admin-originated correction that
   *  has already verified ownership by another means (out of this
   *  module's scope) — never defaulted to `null` implicitly. */
  requestedByProfessionalProfileId?: string | null;
  requestedByCompanyProfileId?: string | null;
}

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * The ONLY mechanism this module provides for correcting an already-
 * ISSUED invoice (see the module brief's "CREDIT NOTES" section). Never
 * mutates the original invoice. Guards against every invalid case the
 * brief calls out by name:
 *
 *  - credit note for a nonexistent invoice -> `NotFoundError`;
 *  - credit note for an invoice belonging to another professional/company
 *    -> `UnauthorizedError` (checked against
 *    `requestedByProfessionalProfileId`/`requestedByCompanyProfileId`);
 *  - credit note exceeding the remaining creditable amount ->
 *    `CreditNoteExceedsRemainingAmountError` (via
 *    `assertCreditNoteWithinRemainingAmount`) — MaestroYa's business
 *    model does not define an "explicitly permits it" exception anywhere
 *    in this codebase, so this is never bypassable;
 *  - duplicate credit notes caused by retries -> `idempotencyKey`,
 *    enforced by `CreditNoteRepository.createOrGetExisting`'s DB-level
 *    unique constraint.
 *
 * IVA/commission figures are always derived via Module 78's
 * `calculateTaxReversal`, never recalculated independently — see this
 * class's own private `deriveReversal` for exactly how a professional-
 * invoice-denominated request is converted into that function's
 * customer-denominated input and back (the ratio is provably constant
 * between the two sides — see that method's own comment) — never a
 * second, competing tax/commission implementation.
 */
export class CreateCreditNoteUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly creditNotes: CreditNoteRepository,
    private readonly taxBreakdowns: CalculateJobTaxBreakdownUseCase,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(input: CreateCreditNoteInput): Promise<CreditNoteRecord> {
    const existingByKey = await this.creditNotes.findByIdempotencyKey(input.idempotencyKey);
    if (existingByKey) {
      if (existingByKey.status === "ISSUED" || existingByKey.status === "CANCELLED") {
        // Already reached a terminal state — nothing left to do. Same
        // idempotent-no-op convention as every other retried financial
        // operation in this codebase.
        return existingByKey;
      }
      // Module 99 fix: a credit note found here in DRAFT means a prior
      // call created it (createOrGetExisting succeeded) but crashed or
      // failed before this same method's own subsequent `issue()` call
      // completed — see this class's own doc comment below on why
      // creation and issuance are not paused/reviewed steps. Before this
      // fix, returning `existingByKey` here left that DRAFT permanently
      // unissued: nothing else in the codebase ever calls
      // `CreditNoteRepository.issue()`. The smallest safe correction is
      // to fall through to the exact same issuance step a brand-new
      // credit note already goes through below, using the already-
      // persisted DRAFT row's own id — never creating a second row, never
      // re-deriving the reversal amounts (they were already computed and
      // written by the earlier, successful `createOrGetExisting` call).
      return this.issueDraft(existingByKey);
    }

    const invoice = await this.invoices.findById(input.originalInvoiceId);
    if (!invoice) {
      throw new NotFoundError("Invoice", input.originalInvoiceId);
    }

    const requestedByProfessionalProfileId = input.requestedByProfessionalProfileId ?? null;
    const requestedByCompanyProfileId = input.requestedByCompanyProfileId ?? null;
    if (requestedByProfessionalProfileId !== null || requestedByCompanyProfileId !== null) {
      const ownsInvoice =
        (requestedByProfessionalProfileId !== null && requestedByProfessionalProfileId === invoice.professionalProfileId) ||
        (requestedByCompanyProfileId !== null && requestedByCompanyProfileId === invoice.companyProfileId);
      if (!ownsInvoice) {
        throw new UnauthorizedError("This invoice belongs to a different professional/company — a credit note cannot be created against it.");
      }
    }

    if (!isCreditableInvoiceStatus(invoice.status)) {
      throw new ValidationError(`Invoice ${invoice.id} is ${invoice.status} — a credit note can only be created against an ISSUED or PAID invoice.`);
    }
    if (!input.reason.trim()) {
      throw new ValidationError("A credit note requires a non-empty reason.");
    }

    const alreadyCredited = await this.creditNotes.sumCreditedAmountForInvoice(invoice.id);
    const remaining = computeRemainingCreditableAmount(invoice.totalAmount, alreadyCredited);
    const requestedAmount = roundToCents(input.requestedAmount ?? remaining);
    if (requestedAmount <= 0) {
      throw new ValidationError("The requested credit note amount must be greater than zero.");
    }
    assertCreditNoteWithinRemainingAmount(invoice.totalAmount, alreadyCredited, requestedAmount);

    const reversal = await this.deriveReversal(invoice.jobId, requestedAmount);

    const created = await this.creditNotes.createOrGetExisting({
      originalInvoiceId: invoice.id,
      professionalProfileId: invoice.professionalProfileId,
      companyProfileId: invoice.companyProfileId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      currency: invoice.currency,
      lineItems: [{ description: `Credit note against invoice ${invoice.invoiceNumber ?? invoice.id}: ${input.reason}`, amount: reversal.refundedProfessionalInvoiceGrossAmount }],
      reversedTaxableBase: reversal.refundedProfessionalNetBase,
      reversedVatRateBps: invoice.vatRateBps,
      reversedVatAmount: reversal.refundedProfessionalVatAmount,
      reversedCommissionAmount: reversal.refundedCommissionAmount,
      reversedIrpfWithholdingAmount: reversal.refundedIrpfWithholdingAmount,
      totalAmount: reversal.refundedProfessionalInvoiceGrossAmount,
    });

    await publishDomainEvent(
      this.eventBus,
      new CreditNoteCreated(created.id, invoice.id, invoice.professionalProfileId, invoice.companyProfileId, created.totalAmount, input.reason),
      this.failureReporter,
    );

    return this.issueDraft(created);
  }

  /**
   * Module 99 fix: extracted so both the brand-new-credit-note path above
   * and the DRAFT-recovery path at the top of `execute()` share the exact
   * same issuance step — never a second issuance implementation. Safe to
   * call with a record already in ISSUED/CANCELLED (returns it unchanged)
   * or DRAFT (attempts the same transactional numbering + compare-and-
   * swap `CreditNoteRepository.issue` call `execute()` always used to
   * call inline) — see `IssueInvoiceUseCase`'s own doc comment for the
   * identical numbering-race protection this shares via
   * `CreditNoteRepository.issue`'s own transaction.
   */
  private async issueDraft(draft: CreditNoteRecord): Promise<CreditNoteRecord> {
    if (draft.status !== "DRAFT") {
      // Already ISSUED (a concurrent/earlier call won the race) or
      // CANCELLED — nothing further to do, same as `execute()`'s own
      // pre-existing "already issued" short-circuit.
      return draft;
    }

    const issueDate = new Date();
    // Module 85 — Invoicing & Credit Note Activation: the number is
    // allocated by `CreditNoteRepository.issue` itself, inside the same
    // transaction as its own compare-and-swap status write — see that
    // method's own doc comment for the numbering-gap race this closes
    // (the identical fix `IssueInvoiceUseCase` applies to invoices).
    const issued = await this.creditNotes.issue({
      id: draft.id,
      issueDate,
      buildDocumentHash: (creditNoteNumber) =>
        computeDocumentHash({
          creditNoteId: draft.id,
          creditNoteNumber,
          originalInvoiceId: draft.originalInvoiceId,
          totalAmount: draft.totalAmount,
          reversedTaxableBase: draft.reversedTaxableBase,
          reversedVatAmount: draft.reversedVatAmount,
          reversedCommissionAmount: draft.reversedCommissionAmount,
          reversedIrpfWithholdingAmount: draft.reversedIrpfWithholdingAmount,
        }),
    });

    await publishDomainEvent(
      this.eventBus,
      new CreditNoteIssued(issued.id, issued.creditNoteNumber as string, draft.originalInvoiceId, issued.totalAmount),
      this.failureReporter,
    );

    return issued;
  }

  /**
   * Converts a professional-invoice-denominated `requestedAmount` into
   * Module 78's `calculateTaxReversal` (customer-denominated) input and
   * back. This is safe — not a fudge — because the ratio between the
   * professional invoice's own gross total and the customer's gross
   * total is a CONSTANT for a given commission rate and VAT rate
   * (`professionalInvoiceGrossTotal / customerGrossTotal = (1 -
   * commissionRate)`, independent of the base amount): scaling
   * `requestedAmount` by the inverse of that same constant and feeding
   * the result through `calculateTaxReversal` therefore reconciles back
   * to (approximately, to the cent) `requestedAmount` on the
   * professional side, while still computing every figure through
   * Module 78's own function rather than re-deriving the arithmetic
   * here.
   */
  private async deriveReversal(jobId: string, requestedAmount: number) {
    const original = await this.taxBreakdowns.execute(jobId);
    if (original.professionalInvoiceGrossTotal <= 0) {
      throw new ValidationError("This job's original invoice total is zero — no credit note can be derived from it.");
    }
    const ratio = original.customerGrossTotal / original.professionalInvoiceGrossTotal;
    const equivalentCustomerRefundAmount = Math.min(
      roundToCents(requestedAmount * ratio),
      original.customerGrossTotal,
    );
    return calculateTaxReversal(original, equivalentCustomerRefundAmount);
  }
}
