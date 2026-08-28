import { describe, expect, it } from "vitest";

import { checkTaxConsistency } from "@/domain/services/reconciliation/tax-checks";
import { makeContext, makeInvoice } from "./fixtures";

describe("checkTaxConsistency", () => {
  it("reports nothing for an ISSUED invoice matching the authoritative tax breakdown", () => {
    expect(checkTaxConsistency(makeContext())).toEqual([]);
  });

  it("flags a taxable-base mismatch on an ISSUED invoice", () => {
    const context = makeContext({ invoices: [makeInvoice({ taxableBase: 800 })] });
    const findings = checkTaxConsistency(context);
    expect(findings.some((f) => f.category === "TAX_TAXABLE_BASE_MISMATCH")).toBe(true);
  });

  it("flags a VAT rate mismatch", () => {
    const context = makeContext({ invoices: [makeInvoice({ vatRateBps: 400 })] });
    const findings = checkTaxConsistency(context);
    expect(findings.some((f) => f.category === "TAX_RATE_MISMATCH")).toBe(true);
  });

  it("flags a VAT amount mismatch", () => {
    const context = makeContext({ invoices: [makeInvoice({ vatAmount: 100 })] });
    const findings = checkTaxConsistency(context);
    expect(findings.some((f) => f.category === "TAX_AMOUNT_MISMATCH")).toBe(true);
  });

  it("flags a total inconsistent with the recomputed gross total", () => {
    const context = makeContext({ invoices: [makeInvoice({ totalAmount: 1200 })] });
    const findings = checkTaxConsistency(context);
    expect(findings.some((f) => f.category === "TAX_INVOICE_TOTAL_MISMATCH")).toBe(true);
  });

  it("ignores a DRAFT invoice's own (expected to be stale) figures", () => {
    const context = makeContext({ invoices: [makeInvoice({ status: "DRAFT", taxableBase: 1 })] });
    expect(checkTaxConsistency(context)).toEqual([]);
  });

  it("flags when Commission and Invoice disagree on the commission amount", () => {
    const context = makeContext({ invoices: [makeInvoice({ commissionAmount: 50 })] });
    const findings = checkTaxConsistency(context);
    expect(findings.some((f) => f.category === "INVOICE_COMMISSION_AMOUNT_INCONSISTENT")).toBe(true);
  });
});
