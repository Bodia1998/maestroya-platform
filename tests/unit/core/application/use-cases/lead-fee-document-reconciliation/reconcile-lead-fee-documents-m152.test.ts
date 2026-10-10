import { describe, expect, it, vi } from "vitest";

import type { LeadFeeDocumentReconciliationReader } from "@/domain/repositories/lead-fee-document-reconciliation-reader";
import { LEAD_FEE_RECONCILIATION_NOTICE, LEAD_FEE_RECONCILIATION_RULES_VERSION, type LeadFeeReconciliationSnapshot } from "@/domain/services/lead-fee-document-reconciliation";
import { ReconcileLeadFeeDocumentsUseCase } from "@/application/use-cases/lead-fee-document-reconciliation/reconcile-lead-fee-documents.use-case";

import { invoiceRecord } from "../../../../../test-utils/lead-fee-credit-note-fixtures";
import { PURCHASE_ID, confirmedPurchase, ledgerEntryFor } from "../../../../../test-utils/lead-fee-invoice-fixtures";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const snapshot = (over: Partial<LeadFeeReconciliationSnapshot> = {}): LeadFeeReconciliationSnapshot => ({
  ledgerEntries: [ledgerEntryFor(confirmedPurchase())],
  invoices: [invoiceRecord()],
  creditNotes: [],
  purchaseStatuses: [{ id: PURCHASE_ID, status: "CONFIRMED" }],
  ...over,
});
const readerOf = (s: LeadFeeReconciliationSnapshot) => ({ readSnapshot: vi.fn(async () => s) }) satisfies LeadFeeDocumentReconciliationReader;

describe("M152 — ReconcileLeadFeeDocumentsUseCase", () => {
  it("returns a clean, labelled report for consistent data", async () => {
    const reader = readerOf(snapshot());
    const report = await new ReconcileLeadFeeDocumentsUseCase(reader, () => NOW).execute();
    expect(report).toMatchObject({
      rulesVersion: LEAD_FEE_RECONCILIATION_RULES_VERSION,
      notice: LEAD_FEE_RECONCILIATION_NOTICE,
      generatedAt: NOW,
      scope: { ledgerEntries: 1, invoices: 1, creditNotes: 0 },
      summary: { total: 0, bySeverity: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0 }, byCode: {} },
      findings: [],
    });
    expect(reader.readSnapshot).toHaveBeenCalledTimes(1);
    expect(report.notice).toMatch(/not a statement of legal, tax or accounting compliance/);
  });

  it("summarises findings by severity and code", async () => {
    const report = await new ReconcileLeadFeeDocumentsUseCase(readerOf(snapshot({ invoices: [] })), () => NOW).execute();
    expect(report.summary).toEqual({ total: 1, bySeverity: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 1 }, byCode: { LEDGER_ENTRY_WITHOUT_INVOICE: 1 } });
  });

  it("same data → same findings on repeated runs (only generatedAt may differ)", async () => {
    const reader = readerOf(snapshot({ invoices: [{ ...invoiceRecord(), totalAmount: "120.00" }] }));
    const times = [new Date("2026-10-10T12:00:00Z"), new Date("2026-10-10T12:05:00Z")];
    const useCase = new ReconcileLeadFeeDocumentsUseCase(reader, () => times.shift() as Date);
    const a = await useCase.execute();
    const b = await useCase.execute();
    expect(a.findings.length).toBeGreaterThan(0);
    expect({ ...b, generatedAt: a.generatedAt }).toEqual(a);
  });

  it("propagates a reader failure instead of returning an empty (clean-looking) report", async () => {
    const reader: LeadFeeDocumentReconciliationReader = { readSnapshot: async () => Promise.reject(new Error("db down")) };
    await expect(new ReconcileLeadFeeDocumentsUseCase(reader).execute()).rejects.toThrow("db down");
  });

  it("depends on a query-only port: the reader has exactly one method and the use case calls nothing else", async () => {
    const reader = readerOf(snapshot());
    await new ReconcileLeadFeeDocumentsUseCase(reader, () => NOW).execute();
    expect(Object.keys(reader)).toEqual(["readSnapshot"]);
  });
});
