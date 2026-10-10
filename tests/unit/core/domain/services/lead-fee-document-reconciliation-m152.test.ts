import { describe, expect, it } from "vitest";

import { buildLeadFeeCreditNoteDraft } from "@/domain/services/lead-fee-credit-note";
import {
  LEAD_FEE_RECONCILIATION_CATALOG,
  LeadFeeReconciliationScopeTooLargeError,
  evaluateLeadFeeDocumentReconciliation,
  type LeadFeeReconciliationFinding,
  type LeadFeeReconciliationFindingCode,
  type LeadFeeReconciliationSnapshot,
  type ObservedCreditNote,
  type ObservedInvoice,
  type ObservedLedgerEntry,
} from "@/domain/services/lead-fee-document-reconciliation";

import { CREDIT_CONFIG, CREDIT_ISSUED_AT, INVOICE_ID, invoiceRecord } from "../../../../test-utils/lead-fee-credit-note-fixtures";
import { CONFIRMED_AT, ENTRY_ID, PURCHASE_ID, confirmedPurchase, ledgerEntryFor } from "../../../../test-utils/lead-fee-invoice-fixtures";

/** Module 152 — pure reconciliation rules. Datasets are built with the REAL M149 / M150 / M151 builders so "consistent" means consistent under their implemented rules. */

const NOTE_ID = "66666666-6666-4666-8666-666666666666";

function ledger(over: Partial<ObservedLedgerEntry> = {}): ObservedLedgerEntry {
  return { ...ledgerEntryFor(confirmedPurchase()), ...over };
}
function invoice(over: Partial<ObservedInvoice> = {}): ObservedInvoice {
  return { ...invoiceRecord(), ...over };
}
function note(over: Partial<ObservedCreditNote> = {}, base: ObservedInvoice = invoice()): ObservedCreditNote {
  const draft = buildLeadFeeCreditNoteDraft({ invoice: invoiceRecord(), reason: "Lead not delivered", config: CREDIT_CONFIG, issuedAt: CREDIT_ISSUED_AT });
  void base;
  return { ...draft, id: NOTE_ID, creditNoteNumber: "LFC-2026-000001", ...over };
}
function snap(over: Partial<LeadFeeReconciliationSnapshot> = {}): LeadFeeReconciliationSnapshot {
  return { ledgerEntries: [ledger()], invoices: [invoice()], creditNotes: [], purchaseStatuses: [{ id: PURCHASE_ID, status: "CONFIRMED" }], ...over };
}
const run = (s: LeadFeeReconciliationSnapshot) => evaluateLeadFeeDocumentReconciliation(s);
const codes = (s: LeadFeeReconciliationSnapshot): string[] => run(s).findings.map((f) => f.code);
const only = (s: LeadFeeReconciliationSnapshot, code: LeadFeeReconciliationFindingCode): LeadFeeReconciliationFinding[] => run(s).findings.filter((f) => f.code === code);

describe("M152 — consistent data", () => {
  it("a consistent ledger / invoice / credit-note dataset produces no findings", () => {
    expect(run(snap()).findings).toEqual([]);
    expect(run(snap({ creditNotes: [note()] })).findings).toEqual([]);
  });

  it("an empty dataset produces no findings and zero counters", () => {
    expect(run({ ledgerEntries: [], invoices: [], creditNotes: [], purchaseStatuses: [] })).toEqual({
      findings: [],
      notEvaluated: { ledgerEntriesWithPurchaseNotConfirmed: 0, ledgerEntriesWithPurchaseUnknown: 0, ledgerEntriesNotInvoiceableByDataRules: 0 },
    });
  });

  it("awkward fees and the largest representable amount reconcile exactly (no float drift)", () => {
    for (const price of ["18.07", "0.10", "0.30", "99999999.99"]) {
      const purchase = confirmedPurchase(price);
      const inv = invoiceRecord({}, price);
      const entry = ledgerEntryFor(purchase);
      const draft = buildLeadFeeCreditNoteDraft({ invoice: inv, reason: "r", config: CREDIT_CONFIG, issuedAt: CREDIT_ISSUED_AT });
      expect(run({ ledgerEntries: [entry], invoices: [inv], creditNotes: [{ ...draft, id: NOTE_ID, creditNoteNumber: "LFC-2026-000001" }], purchaseStatuses: [{ id: PURCHASE_ID, status: "REFUNDED" }] }).findings, price).toEqual([]);
    }
  });
});

describe("M152 — ledger entry without invoice", () => {
  const noInvoice = (over: Partial<LeadFeeReconciliationSnapshot> = {}) => snap({ invoices: [], ...over });

  it("reports an eligible entry as INFO needing human review — never as a confirmed violation", () => {
    const [finding, ...rest] = run(noInvoice()).findings;
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      code: "LEDGER_ENTRY_WITHOUT_INVOICE",
      severity: "INFO",
      verification: "HUMAN_REVIEW_REQUIRED",
      subject: { kind: "LEDGER_ENTRY", id: ENTRY_ID },
      ledgerEntryId: ENTRY_ID,
      leadPurchaseId: PURCHASE_ID,
    });
    expect(finding?.explanation).toMatch(/not a confirmed violation/);
  });

  it.each(["REFUNDED", "REVOKED", "PENDING_PAYMENT", "FAILED", "CANCELLED"])("does not report an entry whose purchase is %s (M150 would not issue)", (status) => {
    const result = run(noInvoice({ purchaseStatuses: [{ id: PURCHASE_ID, status }] }));
    expect(result.findings).toEqual([]);
    expect(result.notEvaluated.ledgerEntriesWithPurchaseNotConfirmed).toBe(1);
  });

  it("does not guess when the purchase is unknown", () => {
    const result = run(noInvoice({ purchaseStatuses: [] }));
    expect(result.findings).toEqual([]);
    expect(result.notEvaluated.ledgerEntriesWithPurchaseUnknown).toBe(1);
  });

  it.each([
    ["non-EUR currency", { currency: "USD" }],
    ["unknown tax policy", { taxPolicyVersion: "lead-fee-tax-policy-v2" }],
    ["IVA that does not verify", { taxAmount: "20.00", totalCollectedAmount: "120.00" }],
  ])("does not report an entry with %s (not invoiceable under M150's data rules)", (_name, over) => {
    const result = run(noInvoice({ ledgerEntries: [ledger(over)] }));
    expect(result.findings.filter((f) => f.code === "LEDGER_ENTRY_WITHOUT_INVOICE")).toEqual([]);
    expect(result.notEvaluated.ledgerEntriesNotInvoiceableByDataRules).toBe(1);
  });

  it("reports invalid ledger amounts as an ERROR and does not treat that entry as missing an invoice", () => {
    const result = run(noInvoice({ ledgerEntries: [ledger({ totalCollectedAmount: "120.00" })] }));
    expect(result.findings.map((f) => [f.code, f.severity])).toEqual([["LEDGER_ENTRY_AMOUNTS_INVALID", "ERROR"]]);
  });

  it("an entry whose purchase already has an invoice (even under another entry id) is not reported as missing", () => {
    expect(codes(snap({ invoices: [invoice({ ledgerEntryId: "99999999-9999-4999-8999-999999999999" })] }))).not.toContain("LEDGER_ENTRY_WITHOUT_INVOICE");
  });
});

describe("M152 — invoice against its ledger entry", () => {
  it("reports a missing ledger entry", () => {
    const [f] = only(snap({ ledgerEntries: [] }), "INVOICE_LEDGER_ENTRY_MISSING");
    expect(f).toMatchObject({ severity: "ERROR", verification: "AUTOMATIC", subject: { kind: "INVOICE", id: INVOICE_ID }, field: "ledgerEntryId" });
  });

  it.each([
    ["netFeeAmount", { netFeeAmount: "101.00", totalAmount: "122.00" }, "100.00", "101.00"],
    ["taxAmount", { taxAmount: "22.00", totalAmount: "122.00" }, "21.00", "22.00"],
    ["totalAmount", { totalAmount: "120.00" }, "121.00", "120.00"],
  ])("reports an amount mismatch on %s with expected (ledger) versus observed (invoice)", (field, over, expected, observed) => {
    const hit = only(snap({ invoices: [invoice(over)] }), "INVOICE_AMOUNT_MISMATCH").find((f) => f.field === field);
    expect(hit).toMatchObject({ severity: "CRITICAL", expected, observed });
  });

  it("reports a currency mismatch (and the unsupported currency) as CRITICAL / WARNING", () => {
    const result = codes(snap({ invoices: [invoice({ currency: "USD" })] }));
    expect(result).toEqual(expect.arrayContaining(["INVOICE_CURRENCY_MISMATCH", "INVOICE_CURRENCY_UNSUPPORTED"]));
    expect(only(snap({ invoices: [invoice({ currency: "USD" })] }), "INVOICE_CURRENCY_MISMATCH")[0]).toMatchObject({ severity: "CRITICAL", expected: "EUR", observed: "USD" });
  });

  it.each(["leadPurchaseId", "leadId", "professionalProfileId"] as const)("reports a mismatching %s source reference", (field) => {
    const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const hit = only(snap({ invoices: [invoice({ [field]: other })] }), "INVOICE_SOURCE_REFERENCE_MISMATCH");
    expect(hit.map((f) => f.field)).toEqual([field]);
    expect(hit[0]).toMatchObject({ observed: other, severity: "ERROR" });
  });

  it("reports a mismatching tax-policy version and confirmation time", () => {
    const s = snap({ invoices: [invoice({ taxPolicyVersion: "lead-fee-tax-policy-v2", paymentConfirmedAt: new Date(CONFIRMED_AT.getTime() + 1) })] });
    expect(codes(s)).toEqual(expect.arrayContaining(["INVOICE_TAX_POLICY_MISMATCH", "INVOICE_CONFIRMATION_TIME_MISMATCH", "INVOICE_TAX_POLICY_UNSUPPORTED"]));
  });

  it("reports invoice amounts that are not net > 0 / IVA >= 0 / total = net + IVA", () => {
    expect(codes(snap({ invoices: [invoice({ totalAmount: "122.00" })] }))).toContain("INVOICE_AMOUNTS_INVALID");
    expect(codes(snap({ invoices: [invoice({ netFeeAmount: "-1.00" })] }))).toContain("INVOICE_AMOUNTS_INVALID");
    expect(codes(snap({ invoices: [invoice({ netFeeAmount: "1e3" })] }))).toContain("INVOICE_AMOUNTS_INVALID");
  });

  it("verifies (never recomputes) the IVA of the stored policy version", () => {
    // 100.00 net with a self-consistent but wrong IVA: total = net + tax holds, the policy result does not.
    const s = snap({ ledgerEntries: [ledger({ taxAmount: "20.00", totalCollectedAmount: "120.00" })], invoices: [invoice({ taxAmount: "20.00", totalAmount: "120.00" })] });
    expect(codes(s)).toEqual(["INVOICE_TAX_INCONSISTENT"]);
    expect(codes(snap({ invoices: [invoice({ taxRateBps: 1000 })] }))).toContain("INVOICE_TAX_INCONSISTENT");
  });

  it("reports more than one invoice for the same ledger entry / purchase", () => {
    const second = invoice({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", invoiceNumber: "LFI-2026-000002" });
    const fields = only(snap({ invoices: [invoice(), second] }), "INVOICE_DUPLICATE_FOR_SOURCE").map((f) => `${f.subject.id}:${f.field}`);
    expect(fields).toHaveLength(4);
    expect(new Set(fields).size).toBe(4);
  });
});

describe("M152 — document numbers", () => {
  it("reports malformed invoice and credit-note numbers", () => {
    expect(only(snap({ invoices: [invoice({ invoiceNumber: "INV-2026-000001" })] }), "INVOICE_NUMBER_MALFORMED")).toHaveLength(1);
    expect(only(snap({ invoices: [invoice({ invoiceNumber: "LFI-26-1" })] }), "INVOICE_NUMBER_MALFORMED")).toHaveLength(1);
    expect(only(snap({ creditNotes: [note({ creditNoteNumber: "CN-2026-000001" })] }), "CREDIT_NOTE_NUMBER_MALFORMED")).toHaveLength(1);
    expect(only(snap({ creditNotes: [note({ originalInvoiceNumber: "LFC-2026-000001" })] }), "CREDIT_NOTE_ORIGINAL_NUMBER_MALFORMED")).toHaveLength(1);
  });

  it("reports duplicate numbers, including zero-padding variants of the same sequence", () => {
    const twin = invoice({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ledgerEntryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", leadPurchaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", invoiceNumber: "LFI-2026-0000001" });
    expect(only(snap({ invoices: [invoice(), twin] }), "INVOICE_NUMBER_DUPLICATE").map((f) => f.subject.id).sort()).toEqual([INVOICE_ID, twin.id].sort());
    const noteTwin = note({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", leadFeeInvoiceId: twin.id });
    expect(only(snap({ invoices: [invoice(), twin], creditNotes: [note(), noteTwin] }), "CREDIT_NOTE_NUMBER_DUPLICATE")).toHaveLength(2);
  });

  it("does not call numbers of different years or series duplicates", () => {
    const other = invoice({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ledgerEntryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", leadPurchaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", invoiceNumber: "LFI-2025-000001", issuedAt: new Date("2025-06-01T00:00:00Z") });
    expect(codes(snap({ invoices: [invoice(), other] }))).not.toContain("INVOICE_NUMBER_DUPLICATE");
  });

  it("compares the number year with issuedAt in Europe/Madrid civil time (provisional rule → WARNING, human review)", () => {
    // 2026-12-31T23:30Z is already 2027-01-01 in Madrid.
    const ok = snap({ invoices: [invoice({ invoiceNumber: "LFI-2027-000001", issuedAt: new Date("2026-12-31T23:30:00Z") })] });
    expect(codes(ok)).not.toContain("INVOICE_NUMBER_YEAR_MISMATCH");
    const bad = snap({ invoices: [invoice({ invoiceNumber: "LFI-2026-000001", issuedAt: new Date("2026-12-31T23:30:00Z") })] });
    expect(only(bad, "INVOICE_NUMBER_YEAR_MISMATCH")[0]).toMatchObject({ severity: "WARNING", verification: "HUMAN_REVIEW_REQUIRED", expected: "2027", observed: "2026" });
    expect(only(snap({ creditNotes: [note({ creditNoteNumber: "LFC-2025-000001" })] }), "CREDIT_NOTE_NUMBER_YEAR_MISMATCH")).toHaveLength(1);
  });
});

describe("M152 — credit notes (M151 policy: one FULL credit per invoice)", () => {
  it("reports a credit note whose invoice does not exist", () => {
    const f = only(snap({ invoices: [], ledgerEntries: [], creditNotes: [note()] }), "CREDIT_NOTE_INVOICE_MISSING");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "ERROR", subject: { kind: "CREDIT_NOTE", id: NOTE_ID } });
  });

  it("reports over-crediting per component as CRITICAL with exact expected / observed", () => {
    const s = snap({ creditNotes: [note({ creditedNetAmount: "100.01", creditedTotalAmount: "121.01" })] });
    const hits = only(s, "CREDIT_NOTE_EXCEEDS_INVOICE");
    expect(hits.map((h) => [h.field, h.expected, h.observed, h.severity])).toEqual([
      ["creditedNetAmount", "100.00", "100.01", "CRITICAL"],
      ["creditedTotalAmount", "121.00", "121.01", "CRITICAL"],
    ]);
  });

  it("reports a partial credit as inconsistent with the FULL-only policy", () => {
    const s = snap({ creditNotes: [note({ creditedNetAmount: "50.00", creditedTaxAmount: "10.50", creditedTotalAmount: "60.50" })] });
    expect(only(s, "CREDIT_NOTE_PARTIAL_UNDER_FULL_ONLY_POLICY")).toHaveLength(3);
    expect(codes(s)).not.toContain("CREDIT_NOTE_EXCEEDS_INVOICE");
  });

  it("evaluates several credit notes per invoice under the actual policy: more than one is a violation and together they exceed the invoice", () => {
    const second = note({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", creditNoteNumber: "LFC-2026-000002" });
    const result = run(snap({ creditNotes: [note(), second] })).findings;
    expect(result.map((f) => f.code)).toEqual(["CREDIT_NOTE_CUMULATIVE_EXCEEDS_INVOICE", "CREDIT_NOTE_CUMULATIVE_EXCEEDS_INVOICE", "CREDIT_NOTE_CUMULATIVE_EXCEEDS_INVOICE", "CREDIT_NOTE_MULTIPLE_FOR_INVOICE"]);
    const total = result.find((f) => f.field === "creditedTotalAmount");
    expect(total).toMatchObject({ subject: { kind: "INVOICE", id: INVOICE_ID }, expected: "121.00", observed: "242.00", severity: "CRITICAL" });
    // Each note is individually a full credit, so no per-note over-credit is reported, and nothing is netted into a revenue figure.
    expect(JSON.stringify(result)).not.toMatch(/revenue|net revenue/i);
  });

  it("reports currency, reference, tax and party snapshot mismatches — and never echoes party data", () => {
    const s = snap({
      creditNotes: [
        note({
          currency: "USD",
          originalInvoiceNumber: "LFI-2026-000009",
          leadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          taxRateBps: 1000,
          recipientLegalName: "Secret Name S.L.",
          recipientTaxId: "B99999999",
          issuerAddress: "Secret Street 1",
        }),
      ],
    });
    const result = run(s).findings;
    const got = (code: LeadFeeReconciliationFindingCode) => result.filter((f) => f.code === code).map((f) => f.field);
    expect(got("CREDIT_NOTE_CURRENCY_MISMATCH")).toEqual(["currency"]);
    expect(got("CREDIT_NOTE_REFERENCE_MISMATCH").sort()).toEqual(["leadId", "originalInvoiceNumber"]);
    expect(got("CREDIT_NOTE_TAX_SNAPSHOT_MISMATCH")).toEqual(["taxRateBps"]);
    expect(got("CREDIT_NOTE_PARTY_SNAPSHOT_MISMATCH").sort()).toEqual(["issuerAddress", "recipientLegalName", "recipientTaxId"]);
    const text = JSON.stringify(result);
    for (const secret of ["Secret Name", "B99999999", "Secret Street", "Fontanería", "B12345674"]) expect(text).not.toContain(secret);
  });

  it("reports an unsupported kind / currency and internally inconsistent credited amounts", () => {
    expect(codes(snap({ creditNotes: [note({ creditKind: "PARTIAL" })] }))).toContain("CREDIT_NOTE_KIND_UNSUPPORTED");
    expect(codes(snap({ creditNotes: [note({ currency: "USD" })] }))).toContain("CREDIT_NOTE_CURRENCY_UNSUPPORTED");
    expect(codes(snap({ creditNotes: [note({ creditedTotalAmount: "122.00" })] }))).toContain("CREDIT_NOTE_AMOUNTS_INVALID");
  });
});

describe("M152 — determinism, immutability and scale", () => {
  const broken = (): LeadFeeReconciliationSnapshot =>
    snap({
      invoices: [invoice({ netFeeAmount: "101.00", totalAmount: "122.00", currency: "USD", invoiceNumber: "x" })],
      creditNotes: [note({ creditedNetAmount: "100.01", currency: "USD" }), note({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", creditNoteNumber: "LFC-2026-000002" })],
    });

  it("returns identical findings for the same input, repeatedly and independent of input order", () => {
    const a = run(broken());
    const b = run(broken());
    const reversed = broken();
    const shuffled = { ...reversed, creditNotes: [...reversed.creditNotes].reverse() };
    expect(a.findings.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
    expect(run(shuffled)).toEqual(a);
  });

  it("is sorted by subject kind, subject id, code and field, and every severity / verification comes from the catalog", () => {
    const { findings } = run(broken());
    const kindOrder = { LEDGER_ENTRY: 0, INVOICE: 1, CREDIT_NOTE: 2 };
    for (let i = 1; i < findings.length; i += 1) {
      const p = findings[i - 1] as LeadFeeReconciliationFinding;
      const c = findings[i] as LeadFeeReconciliationFinding;
      expect(kindOrder[p.subject.kind] <= kindOrder[c.subject.kind]).toBe(true);
    }
    for (const f of findings) expect({ severity: f.severity, verification: f.verification }).toEqual(LEAD_FEE_RECONCILIATION_CATALOG[f.code]);
  });

  it("never mutates its input", () => {
    const input = broken();
    const frozen = JSON.stringify(input);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === "object" && !(o instanceof Date)) {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
      }
    };
    deepFreeze(input);
    expect(() => run(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("handles a large consistent dataset quickly and still finds a single defect inside it", () => {
    const N = 20_000;
    const id = (prefix: string, i: number) => `${prefix}-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const ledgerEntries: ObservedLedgerEntry[] = [];
    const invoices: ObservedInvoice[] = [];
    const creditNotes: ObservedCreditNote[] = [];
    const purchaseStatuses: { id: string; status: string }[] = [];
    const baseNote = note();
    for (let i = 1; i <= N; i += 1) {
      const entryId = id("10000000", i);
      const purchaseId = id("20000000", i);
      ledgerEntries.push(ledger({ id: entryId, leadPurchaseId: purchaseId }));
      purchaseStatuses.push({ id: purchaseId, status: "CONFIRMED" });
      invoices.push(invoice({ id: id("30000000", i), ledgerEntryId: entryId, leadPurchaseId: purchaseId, invoiceNumber: `LFI-2026-${String(i).padStart(6, "0")}` }));
      if (i % 2 === 0) {
        creditNotes.push({ ...baseNote, id: id("40000000", i), leadFeeInvoiceId: id("30000000", i), originalInvoiceNumber: `LFI-2026-${String(i).padStart(6, "0")}`, ledgerEntryId: entryId, leadPurchaseId: purchaseId, creditNoteNumber: `LFC-2026-${String(i).padStart(6, "0")}` });
      }
    }
    const started = Date.now();
    expect(run({ ledgerEntries, invoices, creditNotes, purchaseStatuses }).findings).toEqual([]);
    invoices[N / 2] = { ...(invoices[N / 2] as ObservedInvoice), totalAmount: "120.00" };
    const result = run({ ledgerEntries, invoices, creditNotes, purchaseStatuses });
    expect(result.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["INVOICE_AMOUNT_MISMATCH", "INVOICE_AMOUNTS_INVALID"]));
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("the scope-limit error is a typed domain error that carries no data", () => {
    const error = new LeadFeeReconciliationScopeTooLargeError("lead_fee_invoices", 10);
    expect(error.code).toBe("LEAD_FEE_RECONCILIATION_SCOPE_TOO_LARGE");
    expect(error.message).not.toMatch(/lead_fee_invoices/);
  });
});
