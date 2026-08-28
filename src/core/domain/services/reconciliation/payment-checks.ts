import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import type { DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Payment <-> Job/Quote consistency (spec section 1). Pure: takes an
 * already-gathered `JobFinancialContext`, returns candidate discrepancies.
 * Never recalculates what a payment "should" cost — the only authoritative
 * customer-facing amount is `quoteTotalAmount` (the accepted Quote's own
 * total, Module 11's source of truth), which this reuses rather than
 * re-summing QuoteItems itself.
 */
export function checkPaymentConsistency(context: JobFinancialContext): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const { payments, jobId, quoteId } = context;

  if (payments.length === 0) {
    // Nothing paid yet is not itself a discrepancy (a job may legitimately
    // be pre-payment) — Module 80 only flags a payment that already
    // exists but is inconsistent, never "absence of a payment."
    return findings;
  }

  const captured = payments.filter((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED");

  // --- Duplicate financial payment records where one is expected ---
  // Module 73's InitiateQuotePaymentUseCase guards against a second
  // *active* payment attempt per Quote at write time; reconciliation
  // independently verifies that invariant still holds by inspecting the
  // actually-persisted rows, not trusting that the guard never regressed.
  if (captured.length > 1) {
    for (const dup of captured.slice(1)) {
      findings.push({
        entityType: "PAYMENT",
        entityId: dup.id,
        jobId,
        paymentId: dup.id,
        invoiceId: null,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "DUPLICATE_PAYMENT",
        expectedValue: 1,
        actualValue: captured.length,
        currency: dup.currency,
        explanation: `Job ${jobId} / Quote ${quoteId} has ${captured.length} captured-or-later payments; the architecture expects at most one successful payment per quote. Payment ${dup.id} is a duplicate.`,
      });
    }
  }

  for (const payment of payments) {
    // --- Payment references a nonexistent or incompatible job/quote ---
    if (!payment.quoteId || payment.quoteId !== quoteId) {
      findings.push({
        entityType: "PAYMENT",
        entityId: payment.id,
        jobId,
        paymentId: payment.id,
        invoiceId: null,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "PAYMENT_MISSING_JOB_OR_QUOTE",
        expectedValue: null,
        actualValue: null,
        currency: payment.currency,
        explanation: `Payment ${payment.id} is associated with job ${jobId} but its own quoteId (${payment.quoteId ?? "null"}) does not match the job's quote (${quoteId}).`,
      });
    }

    // --- Payment amount does not match the expected customer-side amount ---
    if (payment.status !== "FAILED" && payment.status !== "CANCELLED") {
      const expected = context.quoteTotalAmount;
      if (Math.abs(payment.amount - expected) >= 0.01) {
        findings.push({
          entityType: "PAYMENT",
          entityId: payment.id,
          jobId,
          paymentId: payment.id,
          invoiceId: null,
          payoutId: null,
          refundId: null,
          creditNoteId: null,
          category: "PAYMENT_AMOUNT_MISMATCH",
          expectedValue: expected,
          actualValue: payment.amount,
          currency: payment.currency,
          explanation: `Payment ${payment.id} amount (${payment.amount} ${payment.currency}) does not match the accepted quote's total (${expected} ${context.quoteCurrency}).`,
        });
      }

      // --- Currency consistency ---
      if (payment.currency !== context.quoteCurrency) {
        findings.push({
          entityType: "PAYMENT",
          entityId: payment.id,
          jobId,
          paymentId: payment.id,
          invoiceId: null,
          payoutId: null,
          refundId: null,
          creditNoteId: null,
          category: "PAYMENT_CURRENCY_MISMATCH",
          expectedValue: null,
          actualValue: null,
          currency: payment.currency,
          explanation: `Payment ${payment.id} currency (${payment.currency}) does not match its Quote's currency (${context.quoteCurrency}).`,
        });
      }
    }

    // --- Payment marked successful without the expected underlying
    //     financial relationship (no jobId resolved at all despite a
    //     captured/settled status) ---
    if ((payment.status === "CAPTURED" || payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED") && !payment.jobId) {
      findings.push({
        entityType: "PAYMENT",
        entityId: payment.id,
        jobId: null,
        paymentId: payment.id,
        invoiceId: null,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "PAYMENT_SUCCESSFUL_WITHOUT_RELATIONSHIP",
        expectedValue: null,
        actualValue: null,
        currency: payment.currency,
        explanation: `Payment ${payment.id} is ${payment.status} but resolves to no Job (no accepted Quote -> Job relationship) — a successful payment must always be traceable to a Job.`,
      });
    }
  }

  return findings;
}
