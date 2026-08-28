import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import { amountsRoughlyEqual, type DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * IVA / tax reconciliation (spec section 3). `context.taxBreakdown` is the
 * live output of `calculateMaestroYaTaxBreakdown` (via
 * `CalculateJobTaxBreakdownUseCase`, Module 78) — the single authoritative
 * tax engine this module consumes and never re-implements. Every
 * comparison here is against an ISSUED Invoice's own persisted figures
 * (the only place Module 78's tax breakdown is actually frozen/persisted
 * today — see `InvoiceRecord`'s own doc comment on why every financial
 * field is a snapshot, never recomputed once created).
 */
export function checkTaxConsistency(context: JobFinancialContext): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const { taxBreakdown, jobId, invoices } = context;

  if (!taxBreakdown) return findings;

  // Only ISSUED/PAID invoices carry a frozen tax snapshot worth diffing —
  // a DRAFT/PENDING_ACCEPTANCE invoice is expected to already differ if
  // rates changed since it was drafted (it hasn't been accepted yet).
  const frozenInvoices = invoices.filter((inv) => inv.status === "ISSUED" || inv.status === "PAID");

  for (const invoice of frozenInvoices) {
    if (!amountsRoughlyEqual(invoice.taxableBase, taxBreakdown.professionalNetBase)) {
      findings.push({
        entityType: "TAX_BREAKDOWN",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "TAX_TAXABLE_BASE_MISMATCH",
        expectedValue: taxBreakdown.professionalNetBase,
        actualValue: invoice.taxableBase,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id}.taxableBase (${invoice.taxableBase}) does not match the current recomputation of professionalNetBase (${taxBreakdown.professionalNetBase}) for job ${jobId}. This is expected to drift if a rate changed after the invoice was ISSUED (the invoice snapshot is authoritative once issued) — investigate whether this reflects an original recording error rather than a later rate change.`,
      });
    }
    if (invoice.vatRateBps !== taxBreakdown.professionalVatRateBps) {
      findings.push({
        entityType: "TAX_BREAKDOWN",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "TAX_RATE_MISMATCH",
        expectedValue: taxBreakdown.professionalVatRateBps,
        actualValue: invoice.vatRateBps,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id}.vatRateBps (${invoice.vatRateBps}) does not match the current IVA rate (${taxBreakdown.professionalVatRateBps} bps) recomputed for job ${jobId}.`,
      });
    }
    if (!amountsRoughlyEqual(invoice.vatAmount, taxBreakdown.professionalVatAmount)) {
      findings.push({
        entityType: "TAX_BREAKDOWN",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "TAX_AMOUNT_MISMATCH",
        expectedValue: taxBreakdown.professionalVatAmount,
        actualValue: invoice.vatAmount,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id}.vatAmount (${invoice.vatAmount}) does not match the recomputed professional VAT amount (${taxBreakdown.professionalVatAmount}) for job ${jobId}.`,
      });
    }
    if (invoice.irpfWithholdingRateBps !== taxBreakdown.irpfWithholdingRateBps || !amountsRoughlyEqual(invoice.irpfWithholdingAmount, taxBreakdown.irpfWithholdingAmount)) {
      findings.push({
        entityType: "TAX_BREAKDOWN",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "TAX_IRPF_MISMATCH",
        expectedValue: taxBreakdown.irpfWithholdingAmount,
        actualValue: invoice.irpfWithholdingAmount,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id} IRPF withholding (rate ${invoice.irpfWithholdingRateBps} bps, amount ${invoice.irpfWithholdingAmount}) does not match the current authoritative IRPF configuration (rate ${taxBreakdown.irpfWithholdingRateBps} bps, amount ${taxBreakdown.irpfWithholdingAmount}) for job ${jobId}.`,
      });
    }
    if (!amountsRoughlyEqual(invoice.totalAmount, taxBreakdown.professionalInvoiceGrossTotal)) {
      findings.push({
        entityType: "TAX_BREAKDOWN",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "TAX_INVOICE_TOTAL_MISMATCH",
        expectedValue: taxBreakdown.professionalInvoiceGrossTotal,
        actualValue: invoice.totalAmount,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id}.totalAmount (${invoice.totalAmount}) does not equal taxableBase + vatAmount recomputed (${taxBreakdown.professionalInvoiceGrossTotal}) for job ${jobId}.`,
      });
    }

    // --- Cross-check against Commission (Module 22) — surfaces the
    //     documented Module 78 divergence for CUSTOMER_PURCHASED-materials
    //     jobs, where CalculateJobCommissionBreakdownUseCase (what
    //     Commission was actually recorded from) counts every MATERIALS
    //     QuoteItem, while CalculateJobTaxBreakdownUseCase (what this
    //     invoice was drafted from) only counts them when
    //     materialsStrategy is PROFESSIONAL_SUPPLIED — see
    //     MODULE_78_IMPLEMENTATION_REPORT.md, "Problems found." Module 80
    //     does not resolve this business-logic question; it only ever
    //     reports the two authoritative figures disagreeing. ---
    if (context.commission && !amountsRoughlyEqual(context.commission.amount, invoice.commissionAmount)) {
      findings.push({
        entityType: "TAX_BREAKDOWN",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "INVOICE_COMMISSION_AMOUNT_INCONSISTENT",
        expectedValue: context.commission.amount,
        actualValue: invoice.commissionAmount,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id}.commissionAmount (${invoice.commissionAmount}, from Module 78's tax engine) does not match Commission ${context.commission.id}.amount (${context.commission.amount}, from Module 64's commission engine) for job ${jobId} — the two authoritative commission calculations disagree for this job (known root cause: CUSTOMER_PURCHASED materials are treated differently by the two engines — verify materialsStrategy before treating this as a new defect).`,
      });
    }
  }

  return findings;
}
