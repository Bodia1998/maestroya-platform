import { describe, expect, it } from "vitest";

import { checkInvoiceConsistency } from "@/domain/services/reconciliation/invoice-checks";
import { makeContext, makeInvoice, makePayout } from "./fixtures";

describe("checkInvoiceConsistency", () => {
  it("reports nothing for a single, correctly-issued invoice", () => {
    expect(checkInvoiceConsistency(makeContext())).toEqual([]);
  });

  it("flags a duplicate non-CANCELLED invoice for the same job", () => {
    const context = makeContext({
      invoices: [makeInvoice({ id: "invoice-1" }), makeInvoice({ id: "invoice-2" })],
    });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "DUPLICATE_ACTIVE_INVOICE")).toBe(true);
  });

  it("does not flag a duplicate when the second invoice is CANCELLED", () => {
    const context = makeContext({
      invoices: [makeInvoice({ id: "invoice-1" }), makeInvoice({ id: "invoice-2", status: "CANCELLED" })],
    });
    expect(checkInvoiceConsistency(context).some((f) => f.category === "DUPLICATE_ACTIVE_INVOICE")).toBe(false);
  });

  it("flags an invoice referencing a job that does not match the gathered context", () => {
    const context = makeContext({ invoices: [makeInvoice({ jobId: "job-other" })] });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_INVALID_JOB_REFERENCE")).toBe(true);
  });

  it("flags an invoice owned by the wrong professional/company", () => {
    const context = makeContext({
      invoices: [makeInvoice({ professionalProfileId: "professional-other", companyProfileId: null })],
    });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_WRONG_PARTY")).toBe(true);
  });

  it("flags an ISSUED invoice missing required immutable metadata", () => {
    const context = makeContext({ invoices: [makeInvoice({ documentHash: null })] });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_MISSING_IMMUTABLE_METADATA")).toBe(true);
  });

  it("flags an ISSUED invoice with no recorded acceptance", () => {
    const context = makeContext({ invoices: [makeInvoice({ acceptedAt: null, acceptedByUserId: null })] });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_ISSUED_WITHOUT_PREREQUISITES")).toBe(true);
  });

  it("flags a PAID invoice with no corresponding PAID payout", () => {
    const context = makeContext({
      invoices: [makeInvoice({ status: "PAID" })],
      payout: makePayout({ status: "PENDING" }),
    });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_PAID_WITHOUT_PAYOUT")).toBe(true);
  });

  it("flags a PAID invoice with no payout at all", () => {
    const context = makeContext({ invoices: [makeInvoice({ status: "PAID" })], payout: null });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_PAID_WITHOUT_PAYOUT")).toBe(true);
  });

  it("does not flag a PAID invoice when the payout is PAID", () => {
    const context = makeContext({ invoices: [makeInvoice({ status: "PAID" })], payout: makePayout({ status: "PAID" }) });
    expect(checkInvoiceConsistency(context).some((f) => f.category === "INVOICE_PAID_WITHOUT_PAYOUT")).toBe(false);
  });

  it("flags an invoice number that does not match the expected series format", () => {
    const context = makeContext({ invoices: [makeInvoice({ invoiceNumber: "BAD-NUMBER" })] });
    const findings = checkInvoiceConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_NUMBERING_ANOMALY")).toBe(true);
  });

  it("does not evaluate CANCELLED invoices for party/metadata/acceptance findings", () => {
    const context = makeContext({
      invoices: [makeInvoice({ status: "CANCELLED", documentHash: null, acceptedAt: null, acceptedByUserId: null })],
    });
    expect(checkInvoiceConsistency(context)).toEqual([]);
  });
});
