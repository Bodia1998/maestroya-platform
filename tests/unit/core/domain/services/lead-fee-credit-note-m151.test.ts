import { describe, expect, it } from "vitest";

import {
  LEAD_FEE_CREDIT_NOTE_ENV,
  LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN,
  LEAD_FEE_CREDIT_NOTE_SERIES,
  LeadFeeCreditNoteNotIssuableError,
  buildLeadFeeCreditNoteDraft,
  formatLeadFeeCreditNoteNumber,
  leadFeeCreditNoteAmountsEqual,
  leadFeeCreditNoteYear,
  normalizeLeadFeeCreditNoteReason,
  resolveLeadFeeCreditNoteIssuanceConfig,
  type LeadFeeCreditNoteRejectionReason,
} from "@/domain/services/lead-fee-credit-note";
import { LEAD_FEE_INVOICE_ENV, LEAD_FEE_INVOICE_NUMBER_PATTERN } from "@/domain/services/lead-fee-invoice";

import { CREDIT_CONFIG, CREDIT_ISSUED_AT, invoiceRecord } from "../../../../test-utils/lead-fee-credit-note-fixtures";

/** Module 151 — pure domain rules: full-credit-only policy, snapshots, exact decimals, numbering, config, typed rejections. */
function reasonOf(fn: () => unknown): LeadFeeCreditNoteRejectionReason {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LeadFeeCreditNoteNotIssuableError);
    return (error as LeadFeeCreditNoteNotIssuableError).reason;
  }
  throw new Error("expected LeadFeeCreditNoteNotIssuableError");
}

const build = (over: Partial<Parameters<typeof buildLeadFeeCreditNoteDraft>[0]> = {}) =>
  buildLeadFeeCreditNoteDraft({ invoice: invoiceRecord(), reason: "Service not delivered", config: CREDIT_CONFIG, issuedAt: CREDIT_ISSUED_AT, ...over });

describe("M151 — valid full credit", () => {
  it("credits the whole invoice with POSITIVE amounts copied from it, and snapshots the invoice reference, issuer and recipient", () => {
    const invoice = invoiceRecord();
    const draft = build({ invoice });
    expect(draft).toMatchObject({
      leadFeeInvoiceId: invoice.id,
      originalInvoiceNumber: "LFI-2026-000001",
      ledgerEntryId: invoice.ledgerEntryId,
      leadPurchaseId: invoice.leadPurchaseId,
      leadId: invoice.leadId,
      professionalProfileId: invoice.professionalProfileId,
      creditKind: "FULL",
      reason: "Service not delivered",
      currency: "EUR",
      creditedNetAmount: "100.00",
      taxRateBps: 2100,
      creditedTaxAmount: "21.00",
      creditedTotalAmount: "121.00",
      taxPolicyVersion: invoice.taxPolicyVersion,
      issuerLegalName: invoice.issuerLegalName,
      issuerTaxId: invoice.issuerTaxId,
      recipientLegalName: invoice.recipientLegalName,
      recipientTaxId: invoice.recipientTaxId,
      recipientPostalCode: invoice.recipientPostalCode,
      policyApprovalReference: "TEST-CN-APPROVAL-1",
      rulesVersion: "lead-fee-credit-note-rules-v1",
    });
    expect(draft.issuedAt.getTime()).toBe(CREDIT_ISSUED_AT.getTime());
    expect(draft.originalInvoiceIssuedAt.getTime()).toBe(invoice.issuedAt.getTime());
    expect(draft.creditedNetAmount.startsWith("-")).toBe(false); // a credit note is not a negative invoice
  });

  it("is a frozen snapshot: it shares no Date instance with the invoice and the invoice is never mutated", () => {
    const invoice = invoiceRecord();
    const before = JSON.stringify(invoice);
    const draft = build({ invoice });
    expect(Object.isFrozen(draft)).toBe(true);
    expect(draft.originalInvoiceIssuedAt).not.toBe(invoice.issuedAt);
    expect(JSON.stringify(invoice)).toBe(before);
  });

  it("copies awkward amounts exactly (no floating-point drift)", () => {
    const invoice = invoiceRecord({ netFeeAmount: "18.07", taxAmount: "3.79", totalAmount: "21.86" }, "18.07");
    const draft = build({ invoice });
    expect([draft.creditedNetAmount, draft.creditedTaxAmount, draft.creditedTotalAmount]).toEqual(["18.07", "3.79", "21.86"]);
  });

  it("uses the issuer snapshot of the INVOICE, not the configured spelling", () => {
    const draft = build({ config: { ...CREDIT_CONFIG, issuer: { ...CREDIT_CONFIG.issuer!, taxId: " b87654321 ", legalName: "Renamed S.L." } } });
    expect(draft.issuerTaxId).toBe("B87654321");
    expect(draft.issuerLegalName).toBe("Issuer Test S.L.");
  });

  it("trims the reason and the approval reference", () => {
    const draft = build({ reason: "  customer cancelled  ", config: { ...CREDIT_CONFIG, policyApprovalReference: "  REF-9 " } });
    expect(draft.reason).toBe("customer cancelled");
    expect(draft.policyApprovalReference).toBe("REF-9");
  });
});

describe("M151 — amounts: full credit only", () => {
  it("accepts requested amounts equal to the invoice in any decimal spelling", () => {
    for (const requested of [
      { netAmount: "100", taxAmount: "21", totalAmount: "121" },
      { netAmount: "100.00", taxAmount: "21.0", totalAmount: "121.0" },
    ]) {
      expect(build({ requestedAmounts: requested }).creditedTotalAmount).toBe("121.00");
    }
  });

  it("rejects a partial credit (CREDIT_EXCEEDS_INVOICE is reserved for amounts above the invoice)", () => {
    expect(reasonOf(() => build({ requestedAmounts: { netAmount: "50.00", taxAmount: "10.50", totalAmount: "60.50" } }))).toBe("PARTIAL_CREDIT_NOT_SUPPORTED");
    expect(reasonOf(() => build({ requestedAmounts: { netAmount: "100.00", taxAmount: "20.99", totalAmount: "120.99" } }))).toBe("PARTIAL_CREDIT_NOT_SUPPORTED");
  });

  it("rejects an over-credit on any component", () => {
    expect(reasonOf(() => build({ requestedAmounts: { netAmount: "100.01", taxAmount: "21.00", totalAmount: "121.01" } }))).toBe("CREDIT_EXCEEDS_INVOICE");
    expect(reasonOf(() => build({ requestedAmounts: { netAmount: "100.00", taxAmount: "21.01", totalAmount: "121.01" } }))).toBe("CREDIT_EXCEEDS_INVOICE");
    expect(reasonOf(() => build({ requestedAmounts: { netAmount: "200.00", taxAmount: "42.00", totalAmount: "242.00" } }))).toBe("CREDIT_EXCEEDS_INVOICE");
  });

  it.each([
    ["negative net", { netAmount: "-100.00", taxAmount: "21.00", totalAmount: "-79.00" }],
    ["zero net", { netAmount: "0.00", taxAmount: "0.00", totalAmount: "0.00" }],
    ["negative tax", { netAmount: "100.00", taxAmount: "-1.00", totalAmount: "99.00" }],
    ["total that is not net + tax", { netAmount: "100.00", taxAmount: "21.00", totalAmount: "120.00" }],
    ["three-decimal precision", { netAmount: "100.001", taxAmount: "21.00", totalAmount: "121.001" }],
    ["exponent notation", { netAmount: "1e2", taxAmount: "21.00", totalAmount: "121.00" }],
    ["non-numeric text", { netAmount: "abc", taxAmount: "21.00", totalAmount: "121.00" }],
    ["a float-looking NaN", { netAmount: "NaN", taxAmount: "21.00", totalAmount: "121.00" }],
  ])("rejects malformed requested amounts as INPUT: %s", (_label, requested) => {
    expect(reasonOf(() => build({ requestedAmounts: requested }))).toBe("INPUT");
  });

  it("leadFeeCreditNoteAmountsEqual compares exact decimals, not strings", () => {
    const draft = build();
    expect(leadFeeCreditNoteAmountsEqual(draft, { netAmount: "100", taxAmount: "21", totalAmount: "121" })).toBe(true);
    expect(leadFeeCreditNoteAmountsEqual(draft, { netAmount: "100", taxAmount: "21", totalAmount: "121.01" })).toBe(false);
    expect(leadFeeCreditNoteAmountsEqual(draft, { netAmount: "x", taxAmount: "21", totalAmount: "121" })).toBe(false);
  });
});

describe("M151 — fail-closed gates", () => {
  it("rejects without a credit-note approval reference (the invoice approval variable is NOT accepted)", () => {
    expect(reasonOf(() => build({ config: { ...CREDIT_CONFIG, policyApprovalReference: null } }))).toBe("POLICY_NOT_APPROVED");
    expect(reasonOf(() => build({ config: { ...CREDIT_CONFIG, policyApprovalReference: "   " } }))).toBe("POLICY_NOT_APPROVED");
    const env = { [LEAD_FEE_INVOICE_ENV.policyApprovalReference]: "INVOICE-APPROVAL-ONLY", MAESTROYA_ISSUER_LEGAL_NAME: "X S.L.", MAESTROYA_ISSUER_TAX_ID: "B87654321", MAESTROYA_ISSUER_ADDRESS: "Calle 1" };
    expect(resolveLeadFeeCreditNoteIssuanceConfig(env).policyApprovalReference).toBeNull();
  });

  it("rejects an unconfigured, incomplete or placeholder issuer", () => {
    expect(reasonOf(() => build({ config: { ...CREDIT_CONFIG, issuer: null } }))).toBe("ISSUER_NOT_CONFIGURED");
    expect(reasonOf(() => build({ config: { ...CREDIT_CONFIG, issuer: { ...CREDIT_CONFIG.issuer!, address: " " } } }))).toBe("ISSUER_NOT_CONFIGURED");
    expect(reasonOf(() => build({ config: { ...CREDIT_CONFIG, issuer: { ...CREDIT_CONFIG.issuer!, taxId: "PENDING-CIF-CONFIRMATION" } } }))).toBe("ISSUER_NOT_CONFIGURED");
  });

  it("rejects when the configured issuer is not the entity that issued the invoice", () => {
    expect(reasonOf(() => build({ config: { ...CREDIT_CONFIG, issuer: { ...CREDIT_CONFIG.issuer!, taxId: "B11111111" } } }))).toBe("ISSUER_MISMATCH");
  });

  it("approval is checked before the invoice is inspected (cheapest, least revealing first)", () => {
    expect(reasonOf(() => build({ invoice: invoiceRecord({ currency: "USD" }), config: { ...CREDIT_CONFIG, policyApprovalReference: null } }))).toBe("POLICY_NOT_APPROVED");
  });

  it.each([
    ["non-EUR currency", { currency: "USD" }, "UNSUPPORTED_CURRENCY"],
    ["unknown tax policy version", { taxPolicyVersion: "lead-fee-tax-policy-v9" }, "UNSUPPORTED_TAX_POLICY"],
    ["IVA that is not the policy's result (total kept consistent)", { taxAmount: "20.00", totalAmount: "120.00" }, "TAX_AMOUNT_INCONSISTENT"],
    ["stored rate that is not the policy's rate", { taxRateBps: 1000 }, "TAX_AMOUNT_INCONSISTENT"],
    ["total that is not net + tax", { totalAmount: "122.00" }, "INVOICE_INVALID"],
    ["zero net", { netFeeAmount: "0.00", taxAmount: "0.00", totalAmount: "0.00" }, "INVOICE_INVALID"],
    ["malformed money", { netFeeAmount: "1e2" }, "INVOICE_INVALID"],
    ["number outside the LFI shape", { invoiceNumber: "INV-2026-000001" }, "INVOICE_INVALID"],
    ["placeholder issuer on the invoice", { issuerTaxId: "PENDING-CIF-CONFIRMATION" }, "INVOICE_INVALID"],
    ["blank recipient name", { recipientLegalName: " " }, "INVOICE_INVALID"],
    ["foreign recipient tax country", { recipientTaxCountry: "DE" }, "UNSUPPORTED_RECIPIENT_COUNTRY"],
    ["foreign recipient country", { recipientCountry: "FR" }, "UNSUPPORTED_RECIPIENT_COUNTRY"],
  ] as const)("rejects an ineligible source invoice: %s", (_label, patch, reason) => {
    expect(reasonOf(() => build({ invoice: invoiceRecord(patch as never) }))).toBe(reason);
  });

  it("rejections carry a static message and no tax id, name, address or reason text", () => {
    try {
      build({ reason: "SECRET-REASON-TEXT", config: { ...CREDIT_CONFIG, issuer: { ...CREDIT_CONFIG.issuer!, taxId: "B11111111" } } });
    } catch (error) {
      const e = error as LeadFeeCreditNoteNotIssuableError;
      expect(e.code).toBe("LEAD_FEE_CREDIT_NOTE_NOT_ISSUABLE");
      expect(`${e.message} ${JSON.stringify(e)}`).not.toMatch(/B87654321|B11111111|B12345674|Fontaner|SECRET-REASON-TEXT|Calle Falsa/);
      return;
    }
    throw new Error("expected rejection");
  });
});

describe("M151 — reason", () => {
  it.each([[""], ["   "], ["x".repeat(501)], ["line one\nline two"], ["tab\there"], ["nul\u0000"], [undefined], [42], [null]])("rejects %j", (reason) => {
    expect(reasonOf(() => normalizeLeadFeeCreditNoteReason(reason))).toBe("CREDIT_REASON_INVALID");
  });

  it("accepts 1..500 characters", () => {
    expect(normalizeLeadFeeCreditNoteReason("x")).toBe("x");
    expect(normalizeLeadFeeCreditNoteReason("é".repeat(500))).toHaveLength(500);
  });
});

describe("M151 — numbering", () => {
  it("formats LFC-YYYY-NNNNNN in a series that cannot collide with invoice numbers or the legacy INV / CN series", () => {
    const n = formatLeadFeeCreditNoteNumber({ year: 2026, sequence: 7 });
    expect(n).toBe("LFC-2026-000007");
    expect(LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN.test(n)).toBe(true);
    expect(LEAD_FEE_INVOICE_NUMBER_PATTERN.test(n)).toBe(false);
    expect(LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN.test("LFI-2026-000007")).toBe(false);
    expect(LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN.test("CN-2026-000007")).toBe(false);
    expect(LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN.test("INV-2026-000007")).toBe(false);
    expect(["LFI", "INV", "CN"]).not.toContain(LEAD_FEE_CREDIT_NOTE_SERIES);
    expect(formatLeadFeeCreditNoteNumber({ year: 2026, sequence: 1234567 })).toBe("LFC-2026-1234567");
  });

  it("rejects invalid years and sequences", () => {
    for (const bad of [{ year: 1999, sequence: 1 }, { year: 2026, sequence: 0 }, { year: 2026, sequence: 1.5 }, { year: Number.NaN, sequence: 1 }]) {
      expect(() => formatLeadFeeCreditNoteNumber(bad)).toThrow(RangeError);
    }
  });

  it("uses the Spanish civil-time year", () => {
    expect(leadFeeCreditNoteYear(new Date("2026-12-31T22:59:59Z"))).toBe(2026);
    expect(leadFeeCreditNoteYear(new Date("2026-12-31T23:00:00Z"))).toBe(2027);
  });
});

describe("M151 — operator configuration", () => {
  const issuerEnv = { MAESTROYA_ISSUER_LEGAL_NAME: "Issuer Test S.L.", MAESTROYA_ISSUER_TAX_ID: "B87654321", MAESTROYA_ISSUER_ADDRESS: "Calle Falsa 123" };

  it("is closed by default", () => {
    expect(resolveLeadFeeCreditNoteIssuanceConfig({})).toEqual({ issuer: null, policyApprovalReference: null });
  });

  it("reads the issuer from the M150 variables and the approval from its own variable", () => {
    const config = resolveLeadFeeCreditNoteIssuanceConfig({ ...issuerEnv, [LEAD_FEE_CREDIT_NOTE_ENV.policyApprovalReference]: " CN-REF " });
    expect(config).toEqual({ issuer: { legalName: "Issuer Test S.L.", taxId: "B87654321", address: "Calle Falsa 123" }, policyApprovalReference: "CN-REF" });
  });

  it("does not infer approval from NODE_ENV or any other variable, and never accepts the placeholder tax id", () => {
    expect(resolveLeadFeeCreditNoteIssuanceConfig({ ...issuerEnv, NODE_ENV: "production", CI: "true" }).policyApprovalReference).toBeNull();
    expect(resolveLeadFeeCreditNoteIssuanceConfig({ ...issuerEnv, MAESTROYA_ISSUER_TAX_ID: "PENDING-CIF-CONFIRMATION" }).issuer).toBeNull();
  });
});
