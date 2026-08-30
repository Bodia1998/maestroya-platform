import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import { amountsRoughlyEqual, type DiscrepancyCandidate } from "@/domain/services/reconciliation/types";
import { roundToCents } from "@/domain/services/money";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Payout reconciliation (spec section 5). The authoritative payout amount
 * is `Payment.amount - Commission.amount` — the exact formula
 * `ExecuteProfessionalPayoutUseCase` itself uses (frozen Commission, never
 * a live recalculation — see that use case's own doc comment). This
 * module never retries or executes a Stripe transfer; it only compares
 * already-persisted numbers.
 */
export function checkPayoutConsistency(context: JobFinancialContext): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const { payout, jobId, commission, payments } = context;

  if (!payout) return findings;

  // --- Payout without a valid eligible job/payment/invoice relationship ---
  if (!commission) {
    findings.push({
      entityType: "PAYOUT",
      entityId: payout.id,
      jobId,
      paymentId: payout.paymentId,
      invoiceId: null,
      payoutId: payout.id,
      refundId: null,
      creditNoteId: null,
      category: "PAYOUT_MISSING_ELIGIBLE_RELATIONSHIP",
      expectedValue: null,
      actualValue: null,
      currency: payout.currency,
      explanation: `Payout ${payout.id} exists for job ${jobId} but no Commission record exists to establish eligibility — a Payout must always be derived from a recorded Commission.`,
    });
    return findings;
  }

  const payment = payments.find((p) => p.id === commission.paymentId);
  if (payment) {
    const expectedAmount = roundToCents(payment.amount - commission.amount);

    if (!amountsRoughlyEqual(payout.amount, expectedAmount)) {
      const category = payout.amount > expectedAmount ? "PAYOUT_EXCEEDS_PAYABLE_AMOUNT" : "PAYOUT_AMOUNT_MISMATCH";
      findings.push({
        entityType: "PAYOUT",
        entityId: payout.id,
        jobId,
        paymentId: payout.paymentId,
        invoiceId: null,
        payoutId: payout.id,
        refundId: null,
        creditNoteId: null,
        category,
        expectedValue: expectedAmount,
        actualValue: payout.amount,
        currency: payout.currency,
        explanation: `Payout ${payout.id}.amount (${payout.amount} ${payout.currency}) does not match the expected professional payout (Payment ${payment.id}.amount ${payment.amount} minus Commission ${commission.amount} = ${expectedAmount}) for job ${jobId}.`,
      });
    }

    if (payout.currency !== payment.currency) {
      findings.push({
        entityType: "PAYOUT",
        entityId: payout.id,
        jobId,
        paymentId: payout.paymentId,
        invoiceId: null,
        payoutId: payout.id,
        refundId: null,
        creditNoteId: null,
        category: "PAYOUT_CURRENCY_MISMATCH",
        expectedValue: null,
        actualValue: null,
        currency: payout.currency,
        explanation: `Payout ${payout.id} currency (${payout.currency}) does not match the source Payment ${payment.id} currency (${payment.currency}).`,
      });
    }
  }

  // --- Duplicate payout: Payout.jobId is @unique at the DB level, so a
  //     true duplicate row can never exist; this check instead flags a
  //     Payout whose own paymentId doesn't match this job's actual
  //     captured payment (i.e. it was seeded/derived from the wrong
  //     payment entirely). ---
  if (payout.paymentId && !payments.some((p) => p.id === payout.paymentId)) {
    findings.push({
      entityType: "PAYOUT",
      entityId: payout.id,
      jobId,
      paymentId: payout.paymentId,
      invoiceId: null,
      payoutId: payout.id,
      refundId: null,
      creditNoteId: null,
      category: "DUPLICATE_PAYOUT",
      expectedValue: null,
      actualValue: null,
      currency: payout.currency,
      explanation: `Payout ${payout.id}.paymentId (${payout.paymentId}) does not correspond to any Payment on job ${jobId} — this Payout may have been recorded against the wrong Payment.`,
    });
  }

  // --- Payout's provider reference vs local record ---
  if (payout.status === "PAID" && !payout.stripeTransferId) {
    findings.push({
      entityType: "PAYOUT",
      entityId: payout.id,
      jobId,
      paymentId: payout.paymentId,
      invoiceId: null,
      payoutId: payout.id,
      refundId: null,
      creditNoteId: null,
      category: "PAYOUT_PROVIDER_REFERENCE_MISMATCH",
      expectedValue: null,
      actualValue: null,
      currency: payout.currency,
      explanation: `Payout ${payout.id} is marked PAID but has no stripeTransferId — a locally PAID payout must always carry the provider's transfer reference.`,
    });
  }

  return findings;
}
