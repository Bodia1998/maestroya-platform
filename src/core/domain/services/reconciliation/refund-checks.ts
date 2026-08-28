import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import type { DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability. Refund
 * reconciliation (spec section 6). Never issues a refund — only compares
 * already-recorded Refund rows against their source Payment.
 */
export function checkRefundConsistency(context: JobFinancialContext): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const { refunds, payments, jobId } = context;
  if (refunds.length === 0) return findings;

  const processed = refunds.filter((r) => r.status === "PROCESSED");
  const byPayment = new Map<string, typeof processed>();
  for (const refund of processed) {
    const list = byPayment.get(refund.paymentId) ?? [];
    list.push(refund);
    byPayment.set(refund.paymentId, list);
  }

  for (const refund of refunds) {
    const payment = payments.find((p) => p.id === refund.paymentId);

    // --- Refund without the expected payment relationship ---
    if (!payment) {
      findings.push({
        entityType: "REFUND",
        entityId: refund.id,
        jobId,
        paymentId: refund.paymentId,
        invoiceId: null,
        payoutId: null,
        refundId: refund.id,
        creditNoteId: null,
        category: "REFUND_MISSING_PAYMENT_RELATIONSHIP",
        expectedValue: null,
        actualValue: null,
        currency: null,
        explanation: `Refund ${refund.id}.paymentId (${refund.paymentId}) does not resolve to any Payment gathered for job ${jobId}.`,
      });
      continue;
    }

    // --- Refund state inconsistent with payment state ---
    if (refund.status === "PROCESSED" && payment.status !== "REFUNDED" && payment.status !== "PARTIALLY_REFUNDED") {
      findings.push({
        entityType: "REFUND",
        entityId: refund.id,
        jobId,
        paymentId: refund.paymentId,
        invoiceId: null,
        payoutId: null,
        refundId: refund.id,
        creditNoteId: null,
        category: "REFUND_STATE_INCONSISTENT_WITH_PAYMENT",
        expectedValue: null,
        actualValue: null,
        currency: payment.currency,
        explanation: `Refund ${refund.id} is PROCESSED but Payment ${payment.id}.status is ${payment.status}, not REFUNDED/PARTIALLY_REFUNDED.`,
      });
    }

    if (refund.status === "PROCESSED" && payment.currency && refund.amount < 0) {
      findings.push({
        entityType: "REFUND",
        entityId: refund.id,
        jobId,
        paymentId: refund.paymentId,
        invoiceId: null,
        payoutId: null,
        refundId: refund.id,
        creditNoteId: null,
        category: "REFUND_AMOUNT_OR_CURRENCY_MISMATCH",
        expectedValue: null,
        actualValue: refund.amount,
        currency: payment.currency,
        explanation: `Refund ${refund.id}.amount (${refund.amount}) is negative — a refund amount must always be a positive value.`,
      });
    }
  }

  // --- Refund exceeding the refundable amount / duplicate refunds ---
  for (const [paymentId, list] of byPayment) {
    const payment = payments.find((p) => p.id === paymentId);
    if (!payment) continue;
    const total = Math.round(list.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
    const lastRefund = list[list.length - 1];
    if (total > payment.amount + 0.01 && lastRefund) {
      findings.push({
        entityType: "REFUND",
        entityId: lastRefund.id,
        jobId,
        paymentId,
        invoiceId: null,
        payoutId: null,
        refundId: lastRefund.id,
        creditNoteId: null,
        category: "REFUND_EXCEEDS_REFUNDABLE_AMOUNT",
        expectedValue: payment.amount,
        actualValue: total,
        currency: payment.currency,
        explanation: `Total PROCESSED refunds for Payment ${paymentId} (${total}) exceed the captured amount (${payment.amount}).`,
      });
    }
    if (list.length > 1) {
      // A payment may legitimately have more than one partial refund;
      // flag only when two rows share the exact same amount AND the
      // exact same financialAdjustmentId-less origin, i.e. an obvious
      // accidental duplicate — same amount appearing twice.
      const seenAmounts = new Set<number>();
      for (const refund of list) {
        if (seenAmounts.has(refund.amount)) {
          findings.push({
            entityType: "REFUND",
            entityId: refund.id,
            jobId,
            paymentId,
            invoiceId: null,
            payoutId: null,
            refundId: refund.id,
            creditNoteId: null,
            category: "DUPLICATE_REFUND",
            expectedValue: null,
            actualValue: null,
            currency: payment.currency,
            explanation: `Payment ${paymentId} has more than one PROCESSED refund of the identical amount (${refund.amount}) — possible duplicate refund ${refund.id}.`,
          });
        }
        seenAmounts.add(refund.amount);
      }
    }
  }

  return findings;
}
