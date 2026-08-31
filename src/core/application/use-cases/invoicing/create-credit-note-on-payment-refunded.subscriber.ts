import type { EventHandler } from "@/application/ports/event-bus";
import type { PaymentRefunded } from "@/domain/events/payment-refunded";
import type { InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { CreditNoteRepository } from "@/domain/repositories/credit-note-repository";
import type { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import type { CreateCreditNoteUseCase } from "./create-credit-note.use-case";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { createCreditNoteForRefundLikeEvent } from "./create-credit-note-for-refund-like-event";

/**
 * Module 85 — Invoicing & Credit Note Activation.
 *
 * Wires `CreateCreditNoteUseCase` — fully built by Module 79, never called
 * from anywhere — into `ExecuteRefundUseCase`'s own `PaymentRefunded`
 * event (Module 77), so a refund against an invoiced Job automatically
 * produces the corrective credit note the module brief requires, instead
 * of leaving the original professional invoice silently stale (still
 * showing the pre-refund amount with nothing on record explaining why the
 * professional was actually paid less). Same "subscribe to an existing
 * event from within invoicing's own compose.ts" convention as
 * `MarkInvoicePaidOnPayoutExecutedSubscriber`/
 * `ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber`.
 *
 * ## Only against an ISSUED/PAID professional invoice
 * If the Job has no `PROFESSIONAL_SELF_BILLED` invoice at all (never
 * self-billing-authorized, predates Module 79/85), or one that never
 * reached `ISSUED`, there is nothing to correct — silently does nothing,
 * mirroring `CheckInvoiceRequiredForPayoutUseCase`'s own "a missing
 * invoice is not an error" posture. A `CUSTOMER_RECEIPT` is not
 * corrected by this handler at all — Module 85 does not extend credit
 * notes to the customer-facing document type; see
 * MODULE_85_IMPLEMENTATION_REPORT.md, "Out-of-scope findings."
 *
 * ## Amount conversion — never a second tax/commission calculation
 * `PaymentRefunded.amount` is denominated in the CUSTOMER's gross
 * currency (what `ExecuteRefundUseCase` actually refunded via Stripe).
 * `CreateCreditNoteUseCase.execute`'s own `requestedAmount` is denominated
 * in the PROFESSIONAL invoice's own gross currency (see that class's own
 * `deriveReversal` doc comment on why the ratio between the two is
 * constant for a given commission/VAT rate). This handler performs the
 * exact same ratio conversion in the opposite direction — reusing
 * `CalculateJobTaxBreakdownUseCase` (Module 78), never re-deriving VAT or
 * commission — and clamps the result to the invoice's own remaining
 * creditable amount (via the same `computeRemainingCreditableAmount`
 * `CreateCreditNoteUseCase` itself already uses) so a rounding difference
 * across the two conversions can never trip
 * `CreditNoteExceedsRemainingAmountError` and permanently strand this
 * refund without a credit note.
 *
 * ## Idempotency
 * `CreateCreditNoteUseCase`'s own idempotency key is derived here as
 * `credit-note:financial-adjustment:<financialAdjustmentId>` — the same
 * `FinancialAdjustment.id` `ExecuteRefundUseCase`'s own idempotency is
 * keyed on (`refund:<financialAdjustmentId>`), so a duplicate
 * `PaymentRefunded` delivery (or a retried refund landing on the same
 * already-`PROCESSED` financial decision) converges on the exact same
 * credit note via `CreditNoteRepository.createOrGetExisting`'s own
 * unique-`idempotencyKey` backstop — never a second credit note for the
 * same refund.
 */
export class CreateCreditNoteOnPaymentRefundedSubscriber implements EventHandler<PaymentRefunded> {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly creditNotes: CreditNoteRepository,
    private readonly taxBreakdowns: CalculateJobTaxBreakdownUseCase,
    private readonly createCreditNote: CreateCreditNoteUseCase,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async handle(event: PaymentRefunded): Promise<void> {
    if (!event.jobId) return;

    await createCreditNoteForRefundLikeEvent(
      {
        invoices: this.invoices,
        creditNotes: this.creditNotes,
        taxBreakdowns: this.taxBreakdowns,
        createCreditNote: this.createCreditNote,
        failureReporter: this.failureReporter,
      },
      {
        jobId: event.jobId,
        paymentId: event.paymentId,
        amount: event.amount,
        financialAdjustmentId: event.financialAdjustmentId,
        reasonLabel: `Refund of payment ${event.paymentId}`,
      },
    );
  }
}
