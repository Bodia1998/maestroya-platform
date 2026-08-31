import type { InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { CreditNoteRepository } from "@/domain/repositories/credit-note-repository";
import { isCreditableInvoiceStatus } from "@/domain/services/invoice-lifecycle";
import { computeRemainingCreditableAmount } from "@/domain/services/credit-note-eligibility";
import { roundToCents } from "@/domain/services/money";
import type { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import type { CreateCreditNoteUseCase } from "./create-credit-note.use-case";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 85/86 — the shared "a captured amount was permanently returned
 * to/lost by the platform against an invoiced Job — correct the
 * professional invoice with a credit note" logic, extracted from
 * `CreateCreditNoteOnPaymentRefundedSubscriber` (Module 85) so Module
 * 86's own `charge.dispute.closed` (LOST) handling can integrate with the
 * exact same Module 85 lifecycle infrastructure instead of duplicating
 * it — see that class's own doc comment for the full amount-conversion/
 * idempotency rationale, unchanged here. The only thing that differs
 * between a refund and a lost Stripe dispute is WHERE the amount/
 * `FinancialAdjustment` id came from (a `Refund` row's own fields vs. a
 * `StripeDispute`'s own fields) — both ultimately reduce to "this many
 * customer-currency units are no longer captured revenue for this Job,
 * attributable to this `FinancialAdjustment.id`," which is exactly this
 * function's input shape.
 */
export interface CreateCreditNoteForRefundLikeEventDeps {
  invoices: InvoiceRepository;
  creditNotes: CreditNoteRepository;
  taxBreakdowns: CalculateJobTaxBreakdownUseCase;
  createCreditNote: CreateCreditNoteUseCase;
  failureReporter?: FailureReporter;
}

export interface RefundLikeEvent {
  jobId: string;
  paymentId: string;
  /** The customer-currency-gross amount no longer captured — a `Refund.amount`
   *  or a `StripeDispute.amount`, denominated identically either way (see
   *  `CreateCreditNoteOnPaymentRefundedSubscriber`'s own doc comment on
   *  `PaymentRefunded.amount`'s currency convention). */
  amount: number;
  financialAdjustmentId: string;
  /** Free-text reason suffix for the credit note's own `reason` field —
   *  e.g. `"Refund of payment ..."` or `"Stripe dispute ... lost"`. */
  reasonLabel: string;
}

export async function createCreditNoteForRefundLikeEvent(
  deps: CreateCreditNoteForRefundLikeEventDeps,
  event: RefundLikeEvent,
): Promise<void> {
  const failureReporter = deps.failureReporter ?? new NullFailureReporter();

  const invoice = await deps.invoices.findByJobIdAndType(event.jobId, "PROFESSIONAL_SELF_BILLED");
  if (!invoice || !isCreditableInvoiceStatus(invoice.status)) return;

  const breakdown = await deps.taxBreakdowns.execute(event.jobId);
  if (breakdown.customerGrossTotal <= 0) return;

  const professionalAmount = roundToCents(event.amount * (breakdown.professionalInvoiceGrossTotal / breakdown.customerGrossTotal));
  if (professionalAmount <= 0) return;

  const alreadyCredited = await deps.creditNotes.sumCreditedAmountForInvoice(invoice.id);
  const remaining = computeRemainingCreditableAmount(invoice.totalAmount, alreadyCredited);
  const requestedAmount = Math.min(professionalAmount, remaining);
  if (requestedAmount <= 0) return;

  try {
    await deps.createCreditNote.execute({
      originalInvoiceId: invoice.id,
      requestedAmount,
      reason: `${event.reasonLabel} (financial adjustment ${event.financialAdjustmentId}).`,
      idempotencyKey: `credit-note:financial-adjustment:${event.financialAdjustmentId}`,
    });
  } catch (error) {
    failureReporter.report(error instanceof Error ? error : new Error(String(error)), {
      jobId: event.jobId,
      invoiceId: invoice.id,
      financialAdjustmentId: event.financialAdjustmentId,
      note: "Automatic credit-note creation failed — requires manual review.",
    });
  }
}
