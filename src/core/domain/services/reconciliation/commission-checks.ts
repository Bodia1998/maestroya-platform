import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import { amountsRoughlyEqual, type DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Commission reconciliation (spec section 2). The authoritative
 * recomputation is `context.commissionBreakdown` — the live output of
 * `CalculateJobCommissionBreakdownUseCase` (Module 64), the exact same use
 * case `RecordCommissionForPaymentUseCase` called when it originally wrote
 * `Commission.rateBps`/`Commission.amount`. This never re-implements the
 * 10% flat-commission formula itself (see `commission-calculation-service.ts`).
 */
export function checkCommissionConsistency(context: JobFinancialContext): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const { commission, commissionBreakdown, jobId } = context;

  if (!commission) return findings;
  if (!commissionBreakdown) {
    findings.push({
      entityType: "COMMISSION",
      entityId: commission.id,
      jobId,
      paymentId: commission.paymentId,
      invoiceId: null,
      payoutId: null,
      refundId: null,
      creditNoteId: null,
      category: "COMMISSION_AMOUNT_MISMATCH",
      expectedValue: null,
      actualValue: commission.amount,
      currency: null,
      explanation: `Commission ${commission.id} exists for job ${jobId} but the authoritative commission breakdown could not be recomputed (missing/invalid Quote or rate configuration) — cannot verify.`,
    });
    return findings;
  }

  if (commission.rateBps !== commissionBreakdown.rates.commissionRateBps) {
    findings.push({
      entityType: "COMMISSION",
      entityId: commission.id,
      jobId,
      paymentId: commission.paymentId,
      invoiceId: null,
      payoutId: null,
      refundId: null,
      creditNoteId: null,
      category: "COMMISSION_RATE_MISMATCH",
      expectedValue: commissionBreakdown.rates.commissionRateBps,
      actualValue: commission.rateBps,
      currency: null,
      explanation: `Commission ${commission.id}.rateBps (${commission.rateBps}) does not match the current authoritative commission rate (${commissionBreakdown.rates.commissionRateBps} bps) recomputed for job ${jobId}. Commission.rateBps is a frozen snapshot, so this alone is not necessarily a defect if the platform rate changed after recording — investigate before treating as an error.`,
    });
  }

  if (!amountsRoughlyEqual(commission.amount, commissionBreakdown.commission)) {
    findings.push({
      entityType: "COMMISSION",
      entityId: commission.id,
      jobId,
      paymentId: commission.paymentId,
      invoiceId: null,
      payoutId: null,
      refundId: null,
      creditNoteId: null,
      category: "COMMISSION_AMOUNT_MISMATCH",
      expectedValue: commissionBreakdown.commission,
      actualValue: commission.amount,
      currency: null,
      explanation: `Commission ${commission.id}.amount (${commission.amount}) does not match commissionBase (${commissionBreakdown.commissionBase}) * rate recomputed for job ${jobId} = ${commissionBreakdown.commission}.`,
    });
  }

  const payment = context.payments.find((p) => p.id === commission.paymentId);
  if (payment) {
    const expectedProfessionalNet = Math.round((payment.amount - commission.amount) * 100) / 100;
    if (!amountsRoughlyEqual(expectedProfessionalNet, commissionBreakdown.professionalPayout)) {
      findings.push({
        entityType: "COMMISSION",
        entityId: commission.id,
        jobId,
        paymentId: commission.paymentId,
        invoiceId: null,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "COMMISSION_PROFESSIONAL_NET_MISMATCH",
        expectedValue: commissionBreakdown.professionalPayout,
        actualValue: expectedProfessionalNet,
        currency: payment.currency,
        explanation: `Professional net derived from Payment ${payment.id} minus Commission ${commission.id} (${expectedProfessionalNet}) does not match the authoritative commission breakdown's professionalPayout (${commissionBreakdown.professionalPayout}) for job ${jobId}.`,
      });
    }
  }

  // --- Customer/platform allocation: commissionBase must equal the
  //     labour+materials the commission was actually charged on ---
  if (!amountsRoughlyEqual(commissionBreakdown.commissionBase, commissionBreakdown.laborSubtotal + commissionBreakdown.materialsSubtotal)) {
    findings.push({
      entityType: "COMMISSION",
      entityId: commission.id,
      jobId,
      paymentId: commission.paymentId,
      invoiceId: null,
      payoutId: null,
      refundId: null,
      creditNoteId: null,
      category: "COMMISSION_ALLOCATION_MISMATCH",
      expectedValue: commissionBreakdown.laborSubtotal + commissionBreakdown.materialsSubtotal,
      actualValue: commissionBreakdown.commissionBase,
      currency: null,
      explanation: `Commission base (${commissionBreakdown.commissionBase}) for job ${jobId} does not equal labour (${commissionBreakdown.laborSubtotal}) + materials (${commissionBreakdown.materialsSubtotal}).`,
    });
  }

  return findings;
}
