import { describe, expect, it } from "vitest";

import {
  LEAD_FEE_INVOICE_DESCRIPTION,
  LEAD_FEE_INVOICE_ENV,
  LEAD_FEE_INVOICE_NUMBER_PATTERN,
  LEAD_FEE_INVOICE_RULES_VERSION,
  LeadFeeInvoiceNotIssuableError,
  buildLeadFeeInvoiceDraft,
  formatLeadFeeInvoiceNumber,
  leadFeeInvoiceYear,
  resolveLeadFeeInvoiceIssuanceConfig,
  type BuildLeadFeeInvoiceInput,
  type LeadFeeInvoiceRejectionReason,
} from "@/domain/services/lead-fee-invoice";

import {
  CONFIRMED_AT,
  ENTRY_ID,
  ISSUED_AT,
  LEAD_ID,
  PROFESSIONAL_ID,
  PURCHASE_ID,
  VALID_CONFIG,
  billingSnapshot,
  confirmedPurchase,
  ledgerEntryFor,
} from "../../../../test-utils/lead-fee-invoice-fixtures";

/** Module 150 — pure invoice rules: amounts come from the persisted ledger entry only; everything else fails closed. */
function input(over: Partial<BuildLeadFeeInvoiceInput> = {}): BuildLeadFeeInvoiceInput {
  const purchase = confirmedPurchase();
  return { ledgerEntry: ledgerEntryFor(purchase), purchase, billing: billingSnapshot(), config: VALID_CONFIG, issuedAt: ISSUED_AT, ...over };
}

function reasonOf(fn: () => unknown): LeadFeeInvoiceRejectionReason {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LeadFeeInvoiceNotIssuableError);
    return (error as LeadFeeInvoiceNotIssuableError).reason;
  }
  throw new Error("expected LeadFeeInvoiceNotIssuableError");
}

describe("M150 — buildLeadFeeInvoiceDraft (valid confirmed ledger entry)", () => {
  it("copies amounts from the ledger entry, the recipient from the billing snapshot and the issuer from the config", () => {
    const draft = buildLeadFeeInvoiceDraft(input());
    expect(draft).toMatchObject({
      ledgerEntryId: ENTRY_ID,
      leadPurchaseId: PURCHASE_ID,
      leadId: LEAD_ID,
      professionalProfileId: PROFESSIONAL_ID,
      issuedAt: ISSUED_AT,
      paymentConfirmedAt: CONFIRMED_AT,
      currency: "EUR",
      netFeeAmount: "100.00",
      taxRateBps: 2100,
      taxAmount: "21.00",
      totalAmount: "121.00",
      description: LEAD_FEE_INVOICE_DESCRIPTION,
      issuerLegalName: "Issuer Test S.L.",
      issuerTaxId: "B87654321",
      issuerAddress: "Calle Falsa 123, 28001 Madrid, ES",
      recipientEntityType: "COMPANY",
      recipientLegalName: "Fontanería Mediterránea S.L.",
      recipientTaxId: "B12345674",
      recipientTaxCountry: "ES",
      recipientAddressLine1: "Carrer Major 12",
      recipientAddressLine2: null,
      recipientCity: "Gandia",
      recipientRegion: "Valencia",
      recipientPostalCode: "46700",
      recipientCountry: "ES",
      billingIdentityRevision: 3,
      rulesVersion: LEAD_FEE_INVOICE_RULES_VERSION,
      policyApprovalReference: "TEST-APPROVAL-REF-1",
    });
    expect(draft.taxPolicyVersion).toBe(ledgerEntryFor(confirmedPurchase()).taxPolicyVersion);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it.each([
    ["18.07", "3.79", "21.86"],
    ["0.01", "0.00", "0.01"],
    ["0.50", "0.11", "0.61"],
    ["1234567.89", "259259.26", "1493827.15"],
    ["100.00", "21.00", "121.00"],
  ])("keeps exact decimals for net %s -> IVA %s, total %s (no float drift, no rounding of the ledger values)", (net, tax, total) => {
    const purchase = confirmedPurchase(net);
    const draft = buildLeadFeeInvoiceDraft(input({ purchase, ledgerEntry: ledgerEntryFor(purchase) }));
    expect([draft.netFeeAmount, draft.taxAmount, draft.totalAmount]).toEqual([net, tax, total]);
    expect(typeof draft.netFeeAmount).toBe("string");
  });

  it("uses the persisted ledger amounts, not current pricing/tax configuration (a stored amount is never recomputed)", () => {
    const purchase = confirmedPurchase("100.00");
    const entry = ledgerEntryFor(purchase);
    // Even if "current" pricing changed, only the ledger entry is read: identical entry -> identical amounts.
    expect(buildLeadFeeInvoiceDraft(input({ purchase, ledgerEntry: entry })).totalAmount).toBe(entry.totalCollectedAmount);
  });

  it("carries only the documented fields: no job value, quote, service revenue, customer data or payment reference", () => {
    const draft = buildLeadFeeInvoiceDraft(input());
    expect(Object.keys(draft).sort()).toEqual(
      [
        "billingIdentityRevision", "billingIdentityVerifiedAt", "currency", "description", "issuedAt", "issuerAddress",
        "issuerLegalName", "issuerTaxId", "leadId", "leadPurchaseId", "ledgerEntryId", "netFeeAmount", "paymentConfirmedAt",
        "policyApprovalReference", "professionalProfileId", "recipientAddressLine1", "recipientAddressLine2", "recipientCity",
        "recipientCountry", "recipientEntityType", "recipientLegalName", "recipientPostalCode", "recipientRegion",
        "recipientTaxCountry", "recipientTaxId", "rulesVersion", "taxAmount", "taxPolicyVersion", "taxRateBps", "totalAmount",
      ].sort(),
    );
    expect(JSON.stringify(draft)).not.toMatch(/estimatedJobValue|jobValue|quote|serviceRevenue|customer|pi_m150/i);
  });

  it("is a detached snapshot: later mutation of the inputs cannot change the draft", () => {
    const issuedAt = new Date(ISSUED_AT);
    const draft = buildLeadFeeInvoiceDraft(input({ issuedAt }));
    issuedAt.setUTCFullYear(1999);
    expect(draft.issuedAt.getTime()).toBe(ISSUED_AT.getTime());
  });
});

describe("M150 — fail-closed rejections (typed, first failure decides)", () => {
  it("rejects without an approved policy reference (null / blank), before reading any data", () => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ config: { ...VALID_CONFIG, policyApprovalReference: null } })))).toBe("POLICY_NOT_APPROVED");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ config: { ...VALID_CONFIG, policyApprovalReference: "   " } })))).toBe("POLICY_NOT_APPROVED");
  });

  it.each([
    ["no issuer", { issuer: null }],
    ["blank legal name", { issuer: { ...VALID_CONFIG.issuer!, legalName: " " } }],
    ["blank address", { issuer: { ...VALID_CONFIG.issuer!, address: "" } }],
    ["blank tax id", { issuer: { ...VALID_CONFIG.issuer!, taxId: "" } }],
    ["the placeholder tax id", { issuer: { ...VALID_CONFIG.issuer!, taxId: "PENDING-CIF-CONFIRMATION" } }],
  ])("rejects an unconfigured issuer: %s", (_label, patch) => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ config: { ...VALID_CONFIG, ...patch } })))).toBe("ISSUER_NOT_CONFIGURED");
  });

  it("rejects a missing purchase", () => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ purchase: null })))).toBe("PURCHASE_NOT_FOUND");
  });

  it.each(["PENDING_PAYMENT", "FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const)("rejects a %s purchase (only CONFIRMED can be invoiced)", (status) => {
    const base = confirmedPurchase();
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ purchase: { ...base, status } })))).toBe("PURCHASE_NOT_CONFIRMED");
  });

  it("rejects an entry that is not a successful-payment entry or has inconsistent money", () => {
    const purchase = confirmedPurchase();
    const entry = ledgerEntryFor(purchase);
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ ledgerEntry: { ...entry, entryType: "OTHER" as never } })))).toBe("LEDGER_ENTRY_INVALID");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ ledgerEntry: { ...entry, totalCollectedAmount: "122.00" } })))).toBe("LEDGER_ENTRY_INVALID");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ ledgerEntry: { ...entry, netFeeAmount: "0.00", taxAmount: "0.00", totalCollectedAmount: "0.00" } })))).toBe("LEDGER_ENTRY_INVALID");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ ledgerEntry: { ...entry, netFeeAmount: "100.001" } })))).toBe("LEDGER_ENTRY_INVALID");
  });

  it.each([
    ["purchase id", { leadPurchaseId: "99999999-9999-4999-8999-999999999999" }],
    ["lead id", { leadId: "99999999-9999-4999-8999-999999999999" }],
    ["professional", { professionalProfileId: "99999999-9999-4999-8999-999999999999" }],
    ["payment reference", { paymentReference: "pi_other" }],
    ["net amount", { netFeeAmount: "101.00", totalCollectedAmount: "122.00" }],
    ["tax amount", { taxAmount: "20.00", totalCollectedAmount: "120.00" }],
    ["currency", { currency: "USD" }],
  ])("rejects a ledger entry that disagrees with the purchase snapshot: %s", (_label, patch) => {
    const purchase = confirmedPurchase();
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ purchase, ledgerEntry: { ...ledgerEntryFor(purchase), ...patch } })))).toBe("LEDGER_PURCHASE_MISMATCH");
  });

  it("rejects an unsupported currency (entry and snapshot agree on USD)", () => {
    const base = confirmedPurchase();
    const purchase = { ...base, financialSnapshot: { ...base.financialSnapshot, currency: "USD" } };
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ purchase, ledgerEntry: ledgerEntryFor(base, { currency: "USD" }) })))).toBe("UNSUPPORTED_CURRENCY");
  });

  it("rejects an unknown / unsupported tax-policy version (missing tax information is never invented)", () => {
    const purchase = confirmedPurchase();
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ purchase, ledgerEntry: ledgerEntryFor(purchase, { taxPolicyVersion: "lead-fee-tax-policy-v2" }) })))).toBe("UNSUPPORTED_TAX_POLICY");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ purchase, ledgerEntry: ledgerEntryFor(purchase, { taxPolicyVersion: "" }) })))).toBe("UNSUPPORTED_TAX_POLICY");
  });

  it("rejects (never 'repairs') a stored IVA that is not what the stored policy version yields", () => {
    const base = confirmedPurchase();
    const purchase = { ...base, financialSnapshot: { ...base.financialSnapshot, taxAmount: "20.00", totalAmount: "120.00" } };
    const entry = ledgerEntryFor(base, { taxAmount: "20.00", totalCollectedAmount: "120.00" });
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ purchase, ledgerEntry: entry })))).toBe("TAX_AMOUNT_INCONSISTENT");
  });

  it("rejects when there is no verified, complete billing identity (null snapshot)", () => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: null })))).toBe("BILLING_IDENTITY_NOT_READY");
  });

  it("rejects a snapshot of another professional or an incomplete one", () => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot({ professionalProfileId: "99999999-9999-4999-8999-999999999999" }) })))).toBe("BILLING_IDENTITY_NOT_READY");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot({ legalName: "" }) })))).toBe("BILLING_IDENTITY_NOT_READY");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot({ taxId: "" }) })))).toBe("BILLING_IDENTITY_NOT_READY");
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot({ addressLine1: "" }) })))).toBe("BILLING_IDENTITY_NOT_READY");
  });

  it.each([
    ["foreign tax country", { taxCountry: "PT" }],
    ["foreign billing country", { country: "FR" }],
  ])("rejects an unsupported recipient country: %s (EU / reverse-charge / non-EU cases are an open decision)", (_label, patch) => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot(patch) })))).toBe("UNSUPPORTED_RECIPIENT_COUNTRY");
  });

  it.each(["35001", "38001", "51001", "52001", "35 001"])("rejects postal code %s outside the IVA territory (Canarias, Ceuta, Melilla)", (postalCode) => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot({ postalCode }) })))).toBe("UNSUPPORTED_TAX_TERRITORY");
  });

  it("rejects a Spanish recipient whose postal code is not a 5-digit Spanish code", () => {
    expect(reasonOf(() => buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot({ postalCode: "AB-12" }) })))).toBe("UNSUPPORTED_TAX_TERRITORY");
  });

  it("accepts both individual and company recipients inside the supported scope, and other Spanish provinces", () => {
    expect(buildLeadFeeInvoiceDraft(input({ billing: billingSnapshot({ entityType: "INDIVIDUAL", postalCode: "28001" }) })).recipientEntityType).toBe("INDIVIDUAL");
  });

  it("the error carries a closed reason and a static message (no tax id, name or address)", () => {
    const error = new LeadFeeInvoiceNotIssuableError("BILLING_IDENTITY_NOT_READY");
    expect(error.code).toBe("LEAD_FEE_INVOICE_NOT_ISSUABLE");
    expect(error.message).not.toMatch(/B12345674|Fontaner|Carrer/);
  });
});

describe("M150 — issuance configuration (environment)", () => {
  const env = {
    [LEAD_FEE_INVOICE_ENV.issuerLegalName]: " Legal S.L. ",
    [LEAD_FEE_INVOICE_ENV.issuerTaxId]: "B11111111",
    [LEAD_FEE_INVOICE_ENV.issuerAddress]: "Calle 1",
    [LEAD_FEE_INVOICE_ENV.policyApprovalReference]: "REF-9",
  };

  it("resolves a complete configuration (trimmed)", () => {
    expect(resolveLeadFeeInvoiceIssuanceConfig(env)).toEqual({
      issuer: { legalName: "Legal S.L.", taxId: "B11111111", address: "Calle 1" },
      policyApprovalReference: "REF-9",
    });
  });

  it("is closed by default: an empty environment configures nothing (no default legal name, no placeholder)", () => {
    expect(resolveLeadFeeInvoiceIssuanceConfig({})).toEqual({ issuer: null, policyApprovalReference: null });
  });

  it.each(Object.values(LEAD_FEE_INVOICE_ENV).slice(0, 3))("any missing issuer variable (%s) leaves the issuer unconfigured", (name) => {
    expect(resolveLeadFeeInvoiceIssuanceConfig({ ...env, [name]: undefined }).issuer).toBeNull();
    expect(resolveLeadFeeInvoiceIssuanceConfig({ ...env, [name]: "  " }).issuer).toBeNull();
  });

  it("treats the known placeholder tax id as unconfigured and a missing approval as not approved", () => {
    expect(resolveLeadFeeInvoiceIssuanceConfig({ ...env, [LEAD_FEE_INVOICE_ENV.issuerTaxId]: "PENDING-CIF-CONFIRMATION" }).issuer).toBeNull();
    expect(resolveLeadFeeInvoiceIssuanceConfig({ ...env, [LEAD_FEE_INVOICE_ENV.policyApprovalReference]: "" }).policyApprovalReference).toBeNull();
  });
});

describe("M150 — numbering helpers", () => {
  it("formats LFI-YYYY-NNNNNN in a series distinct from the legacy INV / CN series", () => {
    expect(formatLeadFeeInvoiceNumber({ year: 2026, sequence: 1 })).toBe("LFI-2026-000001");
    expect(formatLeadFeeInvoiceNumber({ year: 2026, sequence: 1234567 })).toBe("LFI-2026-1234567");
    expect(LEAD_FEE_INVOICE_NUMBER_PATTERN.test(formatLeadFeeInvoiceNumber({ year: 2027, sequence: 42 }))).toBe(true);
    expect(formatLeadFeeInvoiceNumber({ year: 2026, sequence: 1 })).not.toMatch(/^(INV|CN)-/);
  });

  it("rejects an invalid year or sequence", () => {
    expect(() => formatLeadFeeInvoiceNumber({ year: 1999, sequence: 1 })).toThrow(RangeError);
    expect(() => formatLeadFeeInvoiceNumber({ year: 2026, sequence: 0 })).toThrow(RangeError);
    expect(() => formatLeadFeeInvoiceNumber({ year: 2026, sequence: 1.5 })).toThrow(RangeError);
  });

  it("derives the number's year in Spanish civil time (matches the local date around New Year)", () => {
    expect(leadFeeInvoiceYear(new Date("2026-12-31T23:30:00Z"))).toBe(2027); // 00:30 on 1 Jan in Madrid
    expect(leadFeeInvoiceYear(new Date("2026-12-31T22:30:00Z"))).toBe(2026);
    expect(leadFeeInvoiceYear(new Date("2026-06-30T22:30:00Z"))).toBe(2026);
  });
});
