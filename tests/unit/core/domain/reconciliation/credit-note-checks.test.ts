import { describe, expect, it } from "vitest";

import { checkCreditNoteConsistency } from "@/domain/services/reconciliation/credit-note-checks";
import { makeContext, makeCreditNote, makeInvoice } from "./fixtures";

describe("checkCreditNoteConsistency", () => {
  it("reports nothing when there are no credit notes", () => {
    expect(checkCreditNoteConsistency(makeContext({ creditNotes: [] }))).toEqual([]);
  });

  it("reports nothing for a single credit note proportionally consistent with its invoice", () => {
    const context = makeContext({ creditNotes: [makeCreditNote()] });
    expect(checkCreditNoteConsistency(context)).toEqual([]);
  });

  it("flags a credit note referencing an invoice that was not gathered for this job", () => {
    const context = makeContext({ creditNotes: [makeCreditNote({ originalInvoiceId: "invoice-nonexistent" })] });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "CREDIT_NOTE_INVALID_INVOICE_REFERENCE")).toBe(true);
  });

  it("flags a credit note owned by a different party than its original invoice", () => {
    const context = makeContext({
      creditNotes: [makeCreditNote({ professionalProfileId: "professional-other", companyProfileId: null })],
    });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "CREDIT_NOTE_WRONG_PARTY")).toBe(true);
  });

  it("flags a credit note ISSUED against an invoice not in ISSUED/PAID state", () => {
    const context = makeContext({
      invoices: [makeInvoice({ status: "DRAFT" })],
      creditNotes: [makeCreditNote()],
    });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "CREDIT_NOTE_ISSUED_WITHOUT_REQUIRED_STATE")).toBe(true);
  });

  it("flags a credit note number that does not match the expected series format", () => {
    const context = makeContext({ creditNotes: [makeCreditNote({ creditNoteNumber: "BAD-NUMBER" })] });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "CREDIT_NOTE_NUMBERING_ANOMALY")).toBe(true);
  });

  it("flags a credit note whose currency does not match its original invoice", () => {
    const context = makeContext({ creditNotes: [makeCreditNote({ currency: "USD" })] });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "CREDIT_NOTE_AMOUNT_OR_CURRENCY_MISMATCH")).toBe(true);
  });

  it("flags total credit notes exceeding the original invoice's total amount", () => {
    const context = makeContext({
      creditNotes: [
        makeCreditNote({ id: "credit-note-1", totalAmount: 700, reversedVatAmount: 121.36 }),
        makeCreditNote({ id: "credit-note-2", totalAmount: 700, reversedVatAmount: 121.36 }),
      ],
    });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "CREDIT_NOTE_EXCEEDS_REMAINING_CREDITABLE_AMOUNT")).toBe(true);
  });

  it("flags two credit notes for the same invoice with identical amount and reason as a possible duplicate", () => {
    const context = makeContext({
      creditNotes: [
        makeCreditNote({ id: "credit-note-1", totalAmount: 108.9, reason: "Service not completed" }),
        makeCreditNote({ id: "credit-note-2", totalAmount: 108.9, reason: "Service not completed" }),
      ],
    });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "DUPLICATE_CREDIT_NOTE")).toBe(true);
  });

  it("flags a credit note whose reversedVatAmount is not proportional to the invoice's vatAmount", () => {
    const context = makeContext({ creditNotes: [makeCreditNote({ reversedVatAmount: 50 })] });
    const findings = checkCreditNoteConsistency(context);
    expect(findings.some((f) => f.category === "CREDIT_NOTE_TAX_REVERSAL_MISMATCH")).toBe(true);
  });

  it("does not evaluate CANCELLED credit notes for the exceeds-remaining-amount aggregate", () => {
    const context = makeContext({
      creditNotes: [
        makeCreditNote({ id: "credit-note-1", status: "CANCELLED", totalAmount: 1000 }),
        makeCreditNote({ id: "credit-note-2", totalAmount: 108.9 }),
      ],
    });
    expect(checkCreditNoteConsistency(context).some((f) => f.category === "CREDIT_NOTE_EXCEEDS_REMAINING_CREDITABLE_AMOUNT")).toBe(false);
  });
});
