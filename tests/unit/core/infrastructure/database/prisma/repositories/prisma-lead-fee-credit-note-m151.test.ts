import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeadFeeCreditNoteNotIssuableError, buildLeadFeeCreditNoteDraft } from "@/domain/services/lead-fee-credit-note";

import { CREDIT_CONFIG, CREDIT_ISSUED_AT, invoiceRecord } from "../../../../../../test-utils/lead-fee-credit-note-fixtures";

/**
 * Module 151 — Prisma adapter against a MOCKED client: the call contract of `issue` (one transaction, lock ->
 * existing check -> number allocation -> insert, in that order) and error handling. This does NOT prove database
 * behaviour; constraints, triggers, locking and rollback are proven in tests/integration-db.
 */
const { tx, prismaMock, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    leadFeeCreditNote: { findUnique: vi.fn(), create: vi.fn() },
  };
  const prismaMock = {
    leadFeeCreditNote: { findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { tx, prismaMock, calls };
});
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: prismaMock }));

import { PrismaLeadFeeCreditNoteRepository, toLeadFeeCreditNoteCreateData } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-credit-note-repository";

const draft = buildLeadFeeCreditNoteDraft({ invoice: invoiceRecord(), reason: "Lead not delivered", config: CREDIT_CONFIG, issuedAt: CREDIT_ISSUED_AT });

const row = (over: Record<string, unknown> = {}) => ({
  id: "cn-1",
  ...toLeadFeeCreditNoteCreateData(draft, "LFC-2026-000001"),
  creditedNetAmount: "100",
  creditedTaxAmount: "21",
  creditedTotalAmount: "121",
  createdAt: new Date("2026-10-12T09:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.$executeRaw.mockImplementation(async () => (calls.push("lock"), 1));
  tx.leadFeeCreditNote.findUnique.mockImplementation(async () => (calls.push("find"), null));
  tx.$queryRawUnsafe.mockImplementation(async () => (calls.push("allocate"), [{ lastValue: 1 }]));
  tx.leadFeeCreditNote.create.mockImplementation(async () => (calls.push("insert"), row()));
});

describe("M151 — PrismaLeadFeeCreditNoteRepository.issue", () => {
  const repo = new PrismaLeadFeeCreditNoteRepository();

  it("runs lock, existing-check, number allocation and insert in ONE transaction, in that order", async () => {
    const result = await repo.issue(draft);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["lock", "find", "allocate", "insert"]);
    expect(result.created).toBe(true);
    expect(result.creditNote.creditNoteNumber).toBe("LFC-2026-000001");
  });

  it("allocates from the dedicated LFC series (never LFI / INV / CN) for the Spanish-civil-time year, inside the transaction client", async () => {
    await repo.issue(draft);
    const [sql, series, year] = tx.$queryRawUnsafe.mock.calls[0]!;
    expect(sql).toMatch(/invoice_number_counters/);
    expect([series, year]).toEqual(["LFC", 2026]);
    expect(prismaMock.leadFeeCreditNote.findUnique).not.toHaveBeenCalled(); // reads/writes use tx, not the shared client
  });

  it("takes the advisory lock keyed by the invoice id, before anything else", async () => {
    await repo.issue(draft);
    const sql = String(tx.$executeRaw.mock.calls[0]![0].join("?"));
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('lead_fee_credit_note'\), hashtext\(/);
    expect(tx.$executeRaw.mock.calls[0]![1]).toBe(draft.leadFeeInvoiceId);
    expect(calls[0]).toBe("lock");
  });

  it("passes money as exact decimal STRINGS and returns exact 2-decimal strings", async () => {
    await repo.issue(draft);
    const data = tx.leadFeeCreditNote.create.mock.calls[0]![0].data;
    expect([data.creditedNetAmount, data.creditedTaxAmount, data.creditedTotalAmount]).toEqual(["100.00", "21.00", "121.00"]);
    expect(typeof data.creditedNetAmount).toBe("string");
    expect(data.creditNoteNumber).toBe("LFC-2026-000001");
    expect(data.creditKind).toBe("FULL");
    const { creditNote } = await repo.issue(draft);
    expect([creditNote.creditedNetAmount, creditNote.creditedTaxAmount, creditNote.creditedTotalAmount]).toEqual(["100.00", "21.00", "121.00"]);
  });

  it("an existing credit note is returned WITHOUT allocating a number or inserting (losing a concurrent race)", async () => {
    tx.leadFeeCreditNote.findUnique.mockImplementation(async () => (calls.push("find"), row()));
    const result = await repo.issue(draft);
    expect(result.created).toBe(false);
    expect(calls).toEqual(["lock", "find"]);
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(tx.leadFeeCreditNote.create).not.toHaveBeenCalled();
  });

  it("a failing insert propagates out of the transaction callback (so the allocation rolls back with it) and is never swallowed", async () => {
    tx.leadFeeCreditNote.create.mockRejectedValue(new Error("insert failed"));
    await expect(repo.issue(draft)).rejects.toThrow("insert failed");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("a failing allocation propagates and nothing is inserted", async () => {
    tx.$queryRawUnsafe.mockRejectedValue(new Error("counter failed"));
    await expect(repo.issue(draft)).rejects.toThrow("counter failed");
    expect(tx.leadFeeCreditNote.create).not.toHaveBeenCalled();
  });

  it("a unique-constraint race (P2002) resolves to the winner's credit note; with no winner the error propagates", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
    prismaMock.$transaction.mockRejectedValueOnce(p2002);
    prismaMock.leadFeeCreditNote.findUnique.mockResolvedValueOnce(row());
    expect(await repo.issue(draft)).toMatchObject({ created: false });

    prismaMock.$transaction.mockRejectedValueOnce(p2002);
    prismaMock.leadFeeCreditNote.findUnique.mockResolvedValueOnce(null);
    await expect(repo.issue(draft)).rejects.toBe(p2002);
  });

  it("other database errors (e.g. a trigger check violation) propagate unchanged and are not turned into a typed rejection", async () => {
    const failure = new Error("check_violation");
    prismaMock.$transaction.mockRejectedValueOnce(failure);
    await expect(repo.issue(draft)).rejects.toBe(failure);
    expect(failure).not.toBeInstanceOf(LeadFeeCreditNoteNotIssuableError);
  });

  it("refuses to materialise a row whose kind is not FULL", async () => {
    tx.leadFeeCreditNote.findUnique.mockImplementation(async () => row({ creditKind: "PARTIAL" }));
    await expect(repo.issue(draft)).rejects.toThrow(/not a supported kind/);
  });

  it("reads by invoice / purchase through the unique key and a plain filter only", async () => {
    prismaMock.leadFeeCreditNote.findUnique.mockResolvedValue(row());
    prismaMock.leadFeeCreditNote.findFirst.mockResolvedValue(row());
    await repo.findByInvoiceId("i-1");
    await repo.findByLeadPurchaseId("p-1");
    expect(prismaMock.leadFeeCreditNote.findUnique.mock.calls.map((c) => c[0].where)).toEqual([{ leadFeeInvoiceId: "i-1" }]);
    expect(prismaMock.leadFeeCreditNote.findFirst.mock.calls.map((c) => c[0].where)).toEqual([{ leadPurchaseId: "p-1" }]);
  });
});
