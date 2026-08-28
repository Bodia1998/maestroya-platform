import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import type { DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Invoice reconciliation (spec section 4). Never "fixes" an ISSUED
 * invoice — Module 79's own immutability guarantee (see
 * `InvoiceRecord`'s doc comment) is exactly the guarantee this check
 * relies on to compare a frozen snapshot against live data without
 * racing a concurrent write.
 */
export function checkInvoiceConsistency(context: JobFinancialContext): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const { invoices, jobId, professionalProfileId, companyProfileId, payout } = context;

  // --- Duplicate active invoice for a job ---
  const active = invoices.filter((inv) => inv.status !== "CANCELLED");
  if (active.length > 1) {
    for (const dup of active.slice(1)) {
      findings.push({
        entityType: "INVOICE",
        entityId: dup.id,
        jobId,
        paymentId: dup.paymentId,
        invoiceId: dup.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "DUPLICATE_ACTIVE_INVOICE",
        expectedValue: 1,
        actualValue: active.length,
        currency: dup.currency,
        explanation: `Job ${jobId} has ${active.length} non-CANCELLED invoices; Module 79 expects at most one. Invoice ${dup.id} is a duplicate.`,
      });
    }
  }

  for (const invoice of invoices) {
    if (invoice.status === "CANCELLED") continue;

    // --- Invoice references an invalid/mismatched job ---
    if (invoice.jobId !== jobId) {
      findings.push({
        entityType: "INVOICE",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "INVOICE_INVALID_JOB_REFERENCE",
        expectedValue: null,
        actualValue: null,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id}.jobId (${invoice.jobId}) does not match the job it was gathered under (${jobId}).`,
      });
    }

    // --- Invoice references the wrong professional/company ---
    const ownerMatches =
      (invoice.professionalProfileId !== null && invoice.professionalProfileId === professionalProfileId) ||
      (invoice.companyProfileId !== null && invoice.companyProfileId === companyProfileId);
    if (!ownerMatches) {
      findings.push({
        entityType: "INVOICE",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "INVOICE_WRONG_PARTY",
        expectedValue: null,
        actualValue: null,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id} is owned by professional=${invoice.professionalProfileId ?? "null"}/company=${invoice.companyProfileId ?? "null"}, which does not match job ${jobId}'s assigned professional=${professionalProfileId ?? "null"}/company=${companyProfileId ?? "null"}.`,
      });
    }

    // --- Issued without required prerequisites / missing immutable metadata ---
    if (invoice.status === "ISSUED" || invoice.status === "PAID") {
      if (!invoice.invoiceNumber || !invoice.documentHash || !invoice.issueDate) {
        findings.push({
          entityType: "INVOICE",
          entityId: invoice.id,
          jobId,
          paymentId: invoice.paymentId,
          invoiceId: invoice.id,
          payoutId: null,
          refundId: null,
          creditNoteId: null,
          category: "INVOICE_MISSING_IMMUTABLE_METADATA",
          expectedValue: null,
          actualValue: null,
          currency: invoice.currency,
          explanation: `Invoice ${invoice.id} is ${invoice.status} but is missing required immutable document metadata (invoiceNumber=${invoice.invoiceNumber ?? "null"}, documentHash=${invoice.documentHash ? "present" : "null"}, issueDate=${invoice.issueDate ? "present" : "null"}).`,
        });
      }
      if (!invoice.acceptedAt || !invoice.acceptedByUserId) {
        findings.push({
          entityType: "INVOICE",
          entityId: invoice.id,
          jobId,
          paymentId: invoice.paymentId,
          invoiceId: invoice.id,
          payoutId: null,
          refundId: null,
          creditNoteId: null,
          category: "INVOICE_ISSUED_WITHOUT_PREREQUISITES",
          expectedValue: null,
          actualValue: null,
          currency: invoice.currency,
          explanation: `Invoice ${invoice.id} is ${invoice.status} but has no recorded acceptance (acceptedAt=${invoice.acceptedAt ? "present" : "null"}, acceptedByUserId=${invoice.acceptedByUserId ?? "null"}) — Module 79's lifecycle requires ACCEPTED before ISSUED.`,
        });
      }
    }

    // --- Invoice marked PAID without the corresponding payout state ---
    if (invoice.status === "PAID") {
      if (!payout || payout.status !== "PAID") {
        findings.push({
          entityType: "INVOICE",
          entityId: invoice.id,
          jobId,
          paymentId: invoice.paymentId,
          invoiceId: invoice.id,
          payoutId: payout?.id ?? null,
          refundId: null,
          creditNoteId: null,
          category: "INVOICE_PAID_WITHOUT_PAYOUT",
          expectedValue: null,
          actualValue: null,
          currency: invoice.currency,
          explanation: `Invoice ${invoice.id} is marked PAID for job ${jobId} but no Payout with status PAID exists (${payout ? `found Payout ${payout.id} with status ${payout.status}` : "no Payout found at all"}).`,
        });
      }
    }
  }

  // --- Invoice numbering anomaly: any ISSUED/PAID invoice's number must
  //     be unique and follow the YEAR-based series (INV-YYYY-NNNNNN) —
  //     cheap shape check only; true collision detection is a database
  //     unique-constraint concern (`invoices.invoiceNumber` is `@unique`)
  //     this check cannot itself re-verify without a full-table scan, so
  //     it only flags an issued invoice whose number doesn't match the
  //     expected format. ---
  const numberPattern = /^INV-\d{4}-\d{6}$/;
  for (const invoice of invoices) {
    if ((invoice.status === "ISSUED" || invoice.status === "PAID") && invoice.invoiceNumber && !numberPattern.test(invoice.invoiceNumber)) {
      findings.push({
        entityType: "INVOICE",
        entityId: invoice.id,
        jobId,
        paymentId: invoice.paymentId,
        invoiceId: invoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: null,
        category: "INVOICE_NUMBERING_ANOMALY",
        expectedValue: null,
        actualValue: null,
        currency: invoice.currency,
        explanation: `Invoice ${invoice.id}.invoiceNumber ("${invoice.invoiceNumber}") does not match the expected series format (INV-YYYY-NNNNNN).`,
      });
    }
  }

  return findings;
}
