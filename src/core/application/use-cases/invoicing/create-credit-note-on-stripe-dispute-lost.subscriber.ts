import type { EventHandler } from "@/application/ports/event-bus";
import type { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";
import type { InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { CreditNoteRepository } from "@/domain/repositories/credit-note-repository";
import type { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import type { CreateCreditNoteUseCase } from "./create-credit-note.use-case";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { createCreditNoteForRefundLikeEvent } from "./create-credit-note-for-refund-like-event";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling.
 *
 * Wires `CreateCreditNoteUseCase` into `ProcessStripeDisputeWebhookUseCase`'s
 * own `StripeDisputeClosed` event for a `LOST` outcome — the exact same
 * "a refund-shaped event against an invoiced Job automatically produces
 * the corrective credit note" integration
 * `CreateCreditNoteOnPaymentRefundedSubscriber` (Module 85) already
 * establishes for `PaymentRefunded`, reused here (via
 * `createCreditNoteForRefundLikeEvent`, not duplicated — see that
 * function's own doc comment) rather than re-implemented for this
 * module's own event shape.
 *
 * ## Only LOST, only with a Payment/FinancialAdjustment
 * `WON`/`WARNING_CLOSED` never reach this far (see `StripeDisputeClosed`'s
 * own doc comment — `financialAdjustmentId` is null for both, and this
 * handler returns immediately if so, or if the dispute's own Payment/Job
 * link is missing — nothing to correct either way).
 *
 * ## Idempotency
 * Identical to `CreateCreditNoteOnPaymentRefundedSubscriber`'s own —
 * `credit-note:financial-adjustment:<financialAdjustmentId>`, so a
 * duplicate `StripeDisputeClosed` delivery (there is none in practice,
 * since `ProcessStripeDisputeWebhookUseCase.handleClosed` only ever
 * publishes this once per dispute — see that class's own idempotency
 * doc comment) converges on the exact same credit note regardless.
 */
export class CreateCreditNoteOnStripeDisputeLostSubscriber implements EventHandler<StripeDisputeClosed> {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly creditNotes: CreditNoteRepository,
    private readonly taxBreakdowns: CalculateJobTaxBreakdownUseCase,
    private readonly createCreditNote: CreateCreditNoteUseCase,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async handle(event: StripeDisputeClosed): Promise<void> {
    if (event.outcome !== "LOST" || !event.jobId || !event.paymentId || !event.financialAdjustmentId) return;

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
        reasonLabel: `Stripe dispute ${event.stripeDisputeId} lost`,
      },
    );
  }
}
