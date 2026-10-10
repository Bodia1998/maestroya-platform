import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeadFeeInvoiceNotIssuableError, buildLeadFeeInvoiceDraft } from "@/domain/services/lead-fee-invoice";

import { BILLING_DETAILS, ISSUED_AT, VALID_CONFIG, billingSnapshot, confirmedPurchase, ledgerEntryFor } from "../../../../../../test-utils/lead-fee-invoice-fixtures";

/**
 * Module 150 — Prisma adapter against a MOCKED client: the call contract of `issue` (one transaction, lock ->
 * existing check -> identity re-check -> number allocation -> insert, in that order) and error handling. This does
 * NOT prove database behaviour; constraints, triggers, locking and rollback are proven in tests/integration-db.
 */
const { tx, prismaMock, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    leadFeeInvoice: { findUnique: vi.fn(), create: vi.fn() },
  };
  const prismaMock = {
    leadFeeInvoice: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { tx, prismaMock, calls };
});
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: prismaMock }));

import { PrismaLeadFeeInvoiceRepository, toLeadFeeInvoiceCreateData } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository";

const purchase = confirmedPurchase();
const draft = buildLeadFeeInvoiceDraft({ ledgerEntry: ledgerEntryFor(purchase), purchase, billing: billingSnapshot(), config: VALID_CONFIG, issuedAt: ISSUED_AT });

const row = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  ...toLeadFeeInvoiceCreateData(draft, "LFI-2026-000001"),
  netFeeAmount: "100",
  taxAmount: "21",
  totalAmount: "121",
  createdAt: new Date("2026-10-10T08:30:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.$executeRaw.mockImplementation(async () => (calls.push("lock"), 1));
  tx.leadFeeInvoice.findUnique.mockImplementation(async () => (calls.push("find"), null));
  tx.$queryRaw.mockImplementation(async () => (calls.push("identity"), [{ revision: draft.billingIdentityRevision }]));
  tx.$queryRawUnsafe.mockImplementation(async () => (calls.push("allocate"), [{ lastValue: 1 }]));
  tx.leadFeeInvoice.create.mockImplementation(async () => (calls.push("insert"), row()));
});

describe("M150 — PrismaLeadFeeInvoiceRepository.issue", () => {
  const repo = new PrismaLeadFeeInvoiceRepository();

  it("runs lock, existing-check, identity re-check, number allocation and insert in ONE transaction, in that order", async () => {
    const result = await repo.issue(draft);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["lock", "find", "identity", "allocate", "insert"]);
    expect(result.created).toBe(true);
    expect(result.invoice.invoiceNumber).toBe("LFI-2026-000001");
  });

  it("allocates from the dedicated LFI series (never INV / CN) for the Spanish-civil-time year, inside the transaction client", async () => {
    await repo.issue(draft);
    const [sql, series, year] = tx.$queryRawUnsafe.mock.calls[0]!;
    expect(sql).toMatch(/invoice_number_counters/);
    expect([series, year]).toEqual(["LFI", 2026]);
    expect(prismaMock.leadFeeInvoice.findUnique).not.toHaveBeenCalled(); // reads/writes use tx, not the shared client
  });

  it("passes money as exact decimal STRINGS and returns exact 2-decimal strings", async () => {
    await repo.issue(draft);
    const data = tx.leadFeeInvoice.create.mock.calls[0]![0].data;
    expect([data.netFeeAmount, data.taxAmount, data.totalAmount]).toEqual(["100.00", "21.00", "121.00"]);
    expect(typeof data.netFeeAmount).toBe("string");
    expect(data.invoiceNumber).toBe("LFI-2026-000001");
    const { invoice } = await repo.issue(draft);
    expect([invoice.netFeeAmount, invoice.taxAmount, invoice.totalAmount]).toEqual(["100.00", "21.00", "121.00"]);
  });

  it("persists the recipient snapshot and issuer snapshot from the draft, nothing from elsewhere", async () => {
    await repo.issue(draft);
    const data = tx.leadFeeInvoice.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      recipientLegalName: BILLING_DETAILS.legalName,
      recipientTaxId: BILLING_DETAILS.taxId,
      billingIdentityRevision: 3,
      issuerLegalName: "Issuer Test S.L.",
      policyApprovalReference: "TEST-APPROVAL-REF-1",
    });
  });

  it("an existing invoice is returned WITHOUT allocating a number or inserting (losing a concurrent race)", async () => {
    tx.leadFeeInvoice.findUnique.mockImplementation(async () => (calls.push("find"), row()));
    const result = await repo.issue(draft);
    expect(result.created).toBe(false);
    expect(calls).toEqual(["lock", "find"]);
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(tx.leadFeeInvoice.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no verified row any more", []],
    ["a different revision", [{ revision: draft.billingIdentityRevision + 1 }]],
  ])("rejects BILLING_IDENTITY_CHANGED when the identity has %s, before allocating a number", async (_label, rows) => {
    tx.$queryRaw.mockImplementation(async () => (calls.push("identity"), rows));
    await expect(repo.issue(draft)).rejects.toMatchObject({ code: "LEAD_FEE_INVOICE_NOT_ISSUABLE", reason: "BILLING_IDENTITY_CHANGED" });
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(tx.leadFeeInvoice.create).not.toHaveBeenCalled();
  });

  it("a failing insert propagates out of the transaction callback (so the allocation rolls back with it) and is never swallowed", async () => {
    tx.leadFeeInvoice.create.mockRejectedValue(new Error("insert failed"));
    await expect(repo.issue(draft)).rejects.toThrow("insert failed");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("a failing allocation propagates and nothing is inserted", async () => {
    tx.$queryRawUnsafe.mockRejectedValue(new Error("counter failed"));
    await expect(repo.issue(draft)).rejects.toThrow("counter failed");
    expect(tx.leadFeeInvoice.create).not.toHaveBeenCalled();
  });

  it("a unique-constraint race (P2002) resolves to the winner's invoice; with no winner the error propagates", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
    prismaMock.$transaction.mockRejectedValueOnce(p2002);
    prismaMock.leadFeeInvoice.findUnique.mockResolvedValueOnce(row());
    expect(await repo.issue(draft)).toMatchObject({ created: false });

    prismaMock.$transaction.mockRejectedValueOnce(p2002);
    prismaMock.leadFeeInvoice.findUnique.mockResolvedValueOnce(null);
    await expect(repo.issue(draft)).rejects.toBe(p2002);
  });

  it("other database errors (e.g. a trigger check violation) propagate unchanged", async () => {
    const failure = new Error("check_violation");
    prismaMock.$transaction.mockRejectedValueOnce(failure);
    await expect(repo.issue(draft)).rejects.toBe(failure);
    expect(failure).not.toBeInstanceOf(LeadFeeInvoiceNotIssuableError);
  });

  it("reads by ledger entry / purchase through the unique keys only", async () => {
    prismaMock.leadFeeInvoice.findUnique.mockResolvedValue(row());
    await repo.findByLedgerEntryId("e-1");
    await repo.findByLeadPurchaseId("p-1");
    expect(prismaMock.leadFeeInvoice.findUnique.mock.calls.map((c) => c[0].where)).toEqual([{ ledgerEntryId: "e-1" }, { leadPurchaseId: "p-1" }]);
  });
});
