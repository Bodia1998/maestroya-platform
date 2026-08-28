import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import { amountsRoughlyEqual, type DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability. Credit-note
 * reconciliation (spec section 7). Never mutates the original invoice —
 * only compares already-issued CreditNote rows against it.
 */
export function checkCreditNoteConsistency(context: JobFinancialContext): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const { creditNotes, invoices, jobId, professionalProfileId, companyProfileId } = context;
  if (creditNotes.length === 0) return findings;

  const numberPattern = /^CN-\d{4}-\d{6}$/;

  for (const note of creditNotes) {
    const originalInvoice = invoices.find((inv) => inv.id === note.originalInvoiceId);

    // --- Credit note referencing an invalid invoice ---
    if (!originalInvoice) {
      findings.push({
        entityType: "CREDIT_NOTE",
        entityId: note.id,
        jobId,
        paymentId: null,
        invoiceId: note.originalInvoiceId,
        payoutId: null,
        refundId: null,
        creditNoteId: note.id,
        category: "CREDIT_NOTE_INVALID_INVOICE_REFERENCE",
        expectedValue: null,
        actualValue: null,
        currency: note.currency,
        explanation: `CreditNote ${note.id}.originalInvoiceId (${note.originalInvoiceId}) does not resolve to any invoice gathered for job ${jobId}.`,
      });
      continue;
    }

    // --- Credit note referencing an invoice belonging to another party ---
    const noteOwnerMatches =
      (note.professionalProfileId !== null && note.professionalProfileId === professionalProfileId) ||
      (note.companyProfileId !== null && note.companyProfileId === companyProfileId);
    if (!noteOwnerMatches) {
      findings.push({
        entityType: "CREDIT_NOTE",
        entityId: note.id,
        jobId,
        paymentId: null,
        invoiceId: note.originalInvoiceId,
        payoutId: null,
        refundId: null,
        creditNoteId: note.id,
        category: "CREDIT_NOTE_WRONG_PARTY",
        expectedValue: null,
        actualValue: null,
        currency: note.currency,
        explanation: `CreditNote ${note.id} party (professional=${note.professionalProfileId ?? "null"}/company=${note.companyProfileId ?? "null"}) does not match its original Invoice ${originalInvoice.id}'s party (professional=${professionalProfileId ?? "null"}/company=${companyProfileId ?? "null"}).`,
      });
    }

    // --- Credit note issued without the required invoice state ---
    if (note.status === "ISSUED" && originalInvoice.status !== "ISSUED" && originalInvoice.status !== "PAID") {
      findings.push({
        entityType: "CREDIT_NOTE",
        entityId: note.id,
        jobId,
        paymentId: null,
        invoiceId: originalInvoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: note.id,
        category: "CREDIT_NOTE_ISSUED_WITHOUT_REQUIRED_STATE",
        expectedValue: null,
        actualValue: null,
        currency: note.currency,
        explanation: `CreditNote ${note.id} is ISSUED against Invoice ${originalInvoice.id}, which is ${originalInvoice.status} (expected ISSUED or PAID).`,
      });
    }

    // --- Numbering anomaly ---
    if (note.status === "ISSUED" && note.creditNoteNumber && !numberPattern.test(note.creditNoteNumber)) {
      findings.push({
        entityType: "CREDIT_NOTE",
        entityId: note.id,
        jobId,
        paymentId: null,
        invoiceId: originalInvoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: note.id,
        category: "CREDIT_NOTE_NUMBERING_ANOMALY",
        expectedValue: null,
        actualValue: null,
        currency: note.currency,
        explanation: `CreditNote ${note.id}.creditNoteNumber ("${note.creditNoteNumber}") does not match the expected series format (CN-YYYY-NNNNNN).`,
      });
    }

    // --- Currency mismatch against the original invoice ---
    if (note.currency !== originalInvoice.currency) {
      findings.push({
        entityType: "CREDIT_NOTE",
        entityId: note.id,
        jobId,
        paymentId: null,
        invoiceId: originalInvoice.id,
        payoutId: null,
        refundId: null,
        creditNoteId: note.id,
        category: "CREDIT_NOTE_AMOUNT_OR_CURRENCY_MISMATCH",
        expectedValue: null,
        actualValue: null,
        currency: note.currency,
        explanation: `CreditNote ${note.id} currency (${note.currency}) does not match original Invoice ${originalInvoice.id} currency (${originalInvoice.currency}).`,
      });
    }
  }

  // --- Total credit notes exceeding the original invoice's total ---
  const byInvoice = new Map<string, typeof creditNotes>();
  for (const note of creditNotes) {
    if (note.status === "CANCELLED") continue;
    const list = byInvoice.get(note.originalInvoiceId) ?? [];
    list.push(note);
    byInvoice.set(note.originalInvoiceId, list);
  }
  for (const [invoiceId, notes] of byInvoice) {
    const invoice = invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) continue;
    const totalCredited = Math.round(notes.reduce((sum, n) => sum + n.totalAmount, 0) * 100) / 100;
    const lastNote = notes[notes.length - 1];
    if (totalCredited > invoice.totalAmount + 0.01 && lastNote) {
      findings.push({
        entityType: "CREDIT_NOTE",
        entityId: lastNote.id,
        jobId,
        paymentId: null,
        invoiceId,
        payoutId: null,
        refundId: null,
        creditNoteId: lastNote.id,
        category: "CREDIT_NOTE_EXCEEDS_REMAINING_CREDITABLE_AMOUNT",
        expectedValue: invoice.totalAmount,
        actualValue: totalCredited,
        currency: invoice.currency,
        explanation: `Total credit notes issued against Invoice ${invoiceId} (${totalCredited}) exceed its totalAmount (${invoice.totalAmount}).`,
      });
    }

    // --- Idempotency violation: duplicate idempotencyKey should be
    //     impossible under the DB's own unique constraint; flag if two
    //     notes for the same invoice carry an identical
    //     (amount, reason) pair, a proxy for a caller having bypassed the
    //     idempotency key entirely. ---
    const seen = new Set<string>();
    for (const note of notes) {
      const key = `${note.totalAmount}|${note.reason}`;
      if (seen.has(key)) {
        findings.push({
          entityType: "CREDIT_NOTE",
          entityId: note.id,
          jobId,
          paymentId: null,
          invoiceId,
          payoutId: null,
          refundId: null,
          creditNoteId: note.id,
          category: "DUPLICATE_CREDIT_NOTE",
          expectedValue: null,
          actualValue: null,
          currency: note.currency,
          explanation: `Invoice ${invoiceId} has more than one credit note with the identical amount (${note.totalAmount}) and reason — possible duplicate ${note.id}.`,
        });
      }
      seen.add(key);
    }
  }

  if (context.taxBreakdown) {
    for (const [invoiceId, notes] of byInvoice) {
      const invoice = invoices.find((inv) => inv.id === invoiceId);
      if (!invoice) continue;
      for (const note of notes) {
        const ratio = invoice.totalAmount === 0 ? 0 : note.totalAmount / invoice.totalAmount;
        const expectedVat = Math.round(invoice.vatAmount * ratio * 100) / 100;
        if (!amountsRoughlyEqual(note.reversedVatAmount, expectedVat, 0.05)) {
          findings.push({
            entityType: "CREDIT_NOTE",
            entityId: note.id,
            jobId,
            paymentId: null,
            invoiceId,
            payoutId: null,
            refundId: null,
            creditNoteId: note.id,
            category: "CREDIT_NOTE_TAX_REVERSAL_MISMATCH",
            expectedValue: expectedVat,
            actualValue: note.reversedVatAmount,
            currency: note.currency,
            explanation: `CreditNote ${note.id}.reversedVatAmount (${note.reversedVatAmount}) is not proportional to Invoice ${invoiceId}'s vatAmount (${invoice.vatAmount}) for the credited fraction (~${(ratio * 100).toFixed(1)}%); expected ~${expectedVat}.`,
          });
        }
      }
    }
  }

  return findings;
}
