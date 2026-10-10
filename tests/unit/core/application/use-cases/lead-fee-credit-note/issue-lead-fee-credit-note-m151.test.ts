import { describe, expect, it, vi } from "vitest";

import { IssueLeadFeeCreditNoteUseCase } from "@/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note.use-case";
import {
  LeadFeeCreditNoteNotIssuableError,
  type LeadFeeCreditNoteIssuanceConfig,
  type LeadFeeCreditNoteRejectionReason,
} from "@/domain/services/lead-fee-credit-note";
import type { LeadFeeInvoiceRecord } from "@/domain/services/lead-fee-invoice";

import { FakeLeadFeeCreditNoteRepository } from "../../../../../test-utils/fake-lead-fee-credit-note-repository";
import { CREDIT_CONFIG, CREDIT_ISSUED_AT, invoiceRecord } from "../../../../../test-utils/lead-fee-credit-note-fixtures";

/**
 * Module 151 — IssueLeadFeeCreditNoteUseCase over the REAL domain builder and an in-memory repository. Database-level
 * behaviour (constraints, locks, transactions, triggers) is NOT proven here — see tests/integration-db/lead-fee-credit-note.
 */
function world(over: { invoice?: LeadFeeInvoiceRecord | null; config?: LeadFeeCreditNoteIssuanceConfig } = {}) {
  const invoice = over.invoice === undefined ? invoiceRecord() : over.invoice;
  const invoices = { findByLeadPurchaseId: vi.fn(async (id: string) => (invoice && invoice.leadPurchaseId === id ? invoice : null)) };
  const creditNotes = new FakeLeadFeeCreditNoteRepository();
  const config = { current: over.config ?? CREDIT_CONFIG };
  const readConfig = vi.fn(() => config.current);
  const useCase = new IssueLeadFeeCreditNoteUseCase(invoices, creditNotes, readConfig, () => CREDIT_ISSUED_AT);
  return { useCase, invoices, creditNotes, config, readConfig, purchaseId: (invoice ?? invoiceRecord()).leadPurchaseId };
}

async function reasonOf(promise: Promise<unknown>): Promise<LeadFeeCreditNoteRejectionReason> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LeadFeeCreditNoteNotIssuableError);
    return (error as LeadFeeCreditNoteNotIssuableError).reason;
  }
  throw new Error("expected LeadFeeCreditNoteNotIssuableError");
}

describe("M151 — IssueLeadFeeCreditNoteUseCase", () => {
  it("issues the FULL credit note of an eligible invoice: number LFC-2026-000001, snapshots and amounts from the invoice", async () => {
    const w = world();
    const { created, creditNote } = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "Lead not delivered" });
    expect(created).toBe(true);
    expect(creditNote).toMatchObject({
      creditNoteNumber: "LFC-2026-000001",
      originalInvoiceNumber: "LFI-2026-000001",
      creditKind: "FULL",
      creditedNetAmount: "100.00",
      creditedTaxAmount: "21.00",
      creditedTotalAmount: "121.00",
      reason: "Lead not delivered",
      policyApprovalReference: "TEST-CN-APPROVAL-1",
    });
    expect(w.creditNotes.counters.get(2026)).toBe(1);
  });

  it("never modifies the invoice it credits", async () => {
    const invoice = invoiceRecord();
    const before = JSON.stringify(invoice);
    const w = world({ invoice });
    await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" });
    expect(JSON.stringify(invoice)).toBe(before);
  });

  it.each([[undefined], [null], [""], ["not-a-uuid"], [42], [{}]])("rejects a non-UUID purchase id %j as INPUT without any read", async (id) => {
    const w = world();
    expect(await reasonOf(w.useCase.execute({ leadPurchaseId: id as never, reason: "r" }))).toBe("INPUT");
    expect(await reasonOf(w.useCase.execute(undefined as never))).toBe("INPUT");
    expect(w.invoices.findByLeadPurchaseId).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent source invoice and persists nothing", async () => {
    const w = world({ invoice: null });
    expect(await reasonOf(w.useCase.execute({ leadPurchaseId: "11111111-1111-4111-8111-111111111111", reason: "r" }))).toBe("INVOICE_NOT_FOUND");
    expect(w.creditNotes.rows.size).toBe(0);
    expect(w.creditNotes.counters.size).toBe(0);
    expect(w.creditNotes.issueCalls).toBe(0);
  });

  it("rejects an invalid reason before any lookup and persists nothing", async () => {
    const w = world();
    for (const reason of ["", "   ", "x".repeat(501), "a\nb"]) {
      expect(await reasonOf(w.useCase.execute({ leadPurchaseId: w.purchaseId, reason }))).toBe("CREDIT_REASON_INVALID");
    }
    expect(w.invoices.findByLeadPurchaseId).not.toHaveBeenCalled();
    expect(w.creditNotes.issueCalls).toBe(0);
  });

  it("fails closed without approval or issuer: nothing persisted, no number allocated", async () => {
    const noApproval = world({ config: { ...CREDIT_CONFIG, policyApprovalReference: null } });
    expect(await reasonOf(noApproval.useCase.execute({ leadPurchaseId: noApproval.purchaseId, reason: "r" }))).toBe("POLICY_NOT_APPROVED");
    const noIssuer = world({ config: { ...CREDIT_CONFIG, issuer: null } });
    expect(await reasonOf(noIssuer.useCase.execute({ leadPurchaseId: noIssuer.purchaseId, reason: "r" }))).toBe("ISSUER_NOT_CONFIGURED");
    for (const w of [noApproval, noIssuer]) {
      expect(w.creditNotes.issueCalls).toBe(0);
      expect(w.creditNotes.counters.size).toBe(0);
    }
  });

  it("rejects ineligible invoices (currency, tax policy, foreign recipient) with typed reasons", async () => {
    for (const [patch, reason] of [
      [{ currency: "USD" }, "UNSUPPORTED_CURRENCY"],
      [{ taxPolicyVersion: "lead-fee-tax-policy-v9" }, "UNSUPPORTED_TAX_POLICY"],
      [{ recipientTaxCountry: "DE" }, "UNSUPPORTED_RECIPIENT_COUNTRY"],
    ] as const) {
      const w = world({ invoice: invoiceRecord(patch as never) });
      expect(await reasonOf(w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" }))).toBe(reason);
      expect(w.creditNotes.rows.size).toBe(0);
    }
  });

  it("supports only the full amount: matching amounts are accepted, partial and over-credit are rejected", async () => {
    const w = world();
    const ok = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r", requestedAmounts: { netAmount: "100", taxAmount: "21", totalAmount: "121" } });
    expect(ok.created).toBe(true);

    const partial = world();
    expect(await reasonOf(partial.useCase.execute({ leadPurchaseId: partial.purchaseId, reason: "r", requestedAmounts: { netAmount: "50.00", taxAmount: "10.50", totalAmount: "60.50" } }))).toBe("PARTIAL_CREDIT_NOT_SUPPORTED");
    const over = world();
    expect(await reasonOf(over.useCase.execute({ leadPurchaseId: over.purchaseId, reason: "r", requestedAmounts: { netAmount: "100.01", taxAmount: "21.00", totalAmount: "121.01" } }))).toBe("CREDIT_EXCEEDS_INVOICE");
    expect(partial.creditNotes.rows.size + over.creditNotes.rows.size).toBe(0);
  });

  describe("idempotency", () => {
    it("a duplicate request returns the SAME credit note, creates no row and consumes no number", async () => {
      const w = world();
      const first = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "first reason" });
      const second = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "first reason" });
      expect(second.created).toBe(false);
      expect(second.creditNote.id).toBe(first.creditNote.id);
      expect(w.creditNotes.rows.size).toBe(1);
      expect(w.creditNotes.counters.get(2026)).toBe(1);
      expect(w.creditNotes.issueCalls).toBe(1);
    });

    it("a replay with a different reason returns the stored document unchanged", async () => {
      const w = world();
      const first = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "original" });
      const replay = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "something else entirely" });
      expect(replay.creditNote.reason).toBe("original");
      expect(replay.creditNote.id).toBe(first.creditNote.id);
    });

    it("a replay does not re-read the configuration: closing the gate later does not hide an issued credit note", async () => {
      const w = world();
      await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" });
      const readsBefore = w.readConfig.mock.calls.length;
      w.config.current = { issuer: null, policyApprovalReference: null };
      const replay = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" });
      expect(replay.created).toBe(false);
      expect(w.readConfig.mock.calls.length).toBe(readsBefore);
    });

    it("a replay asking for different (partial) amounts is rejected rather than answered with a mismatching document", async () => {
      const w = world();
      await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" });
      expect(await reasonOf(w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r", requestedAmounts: { netAmount: "10.00", taxAmount: "2.10", totalAmount: "12.10" } }))).toBe("PARTIAL_CREDIT_NOT_SUPPORTED");
      const same = await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r", requestedAmounts: { netAmount: "100", taxAmount: "21", totalAmount: "121" } });
      expect(same.created).toBe(false);
    });

    it("reads the configuration on every issuance (a change takes effect without a code deploy)", async () => {
      const w = world({ config: { ...CREDIT_CONFIG, policyApprovalReference: null } });
      expect(await reasonOf(w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" }))).toBe("POLICY_NOT_APPROVED");
      w.config.current = CREDIT_CONFIG;
      expect((await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" })).created).toBe(true);
      expect(w.readConfig).toHaveBeenCalledTimes(2);
    });
  });

  describe("concurrency and rollback (in-memory contract only; PostgreSQL proves the real thing)", () => {
    it("concurrent requests for the same invoice create exactly one credit note and consume exactly one number", async () => {
      const w = world();
      const results = await Promise.all(Array.from({ length: 8 }, () => w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" })));
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(results.map((r) => r.creditNote.id)).size).toBe(1);
      expect(w.creditNotes.counters.get(2026)).toBe(1);
    });

    it("a failure after number allocation propagates, leaves no row and does not burn the number", async () => {
      const w = world();
      w.creditNotes.failAfterAllocation = new Error("db down");
      await expect(w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" })).rejects.toThrow("db down");
      expect(w.creditNotes.rows.size).toBe(0);
      expect(w.creditNotes.counters.size).toBe(0);
      w.creditNotes.failAfterAllocation = null;
      expect((await w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" })).creditNote.creditNoteNumber).toBe("LFC-2026-000001");
    });

    it("unexpected invoice-read errors propagate and are never turned into a credit note or a typed rejection", async () => {
      const w = world();
      w.invoices.findByLeadPurchaseId.mockRejectedValueOnce(new Error("read failed"));
      await expect(w.useCase.execute({ leadPurchaseId: w.purchaseId, reason: "r" })).rejects.toThrow("read failed");
      expect(w.creditNotes.rows.size).toBe(0);
    });
  });
});
