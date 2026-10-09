import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeadFeeLedgerConflictError, buildLeadFeeRevenueLedgerEntry } from "@/domain/services/lead-fee-revenue-ledger";
import { InvalidLeadPurchaseTransitionError } from "@/domain/services/lead-purchase";

import { SNAPSHOT_DATA } from "../../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../../test-utils/lead-purchase-fixtures";

/** Module 149 — Prisma adapters against a mocked client: atomic confirm+entry and idempotent recordIfAbsent. */
const NOW = new Date("2026-10-09T10:00:00.000Z");
const PUBLISHED_AT = new Date("2026-10-01T00:00:00.000Z");
const SOURCE = { providerEventId: "evt_1", providerEventCreatedAt: NOW };

const { tx, prismaMock } = vi.hoisted(() => {
  const tx = {
    leadPurchase: { updateMany: vi.fn(), findUnique: vi.fn() },
    leadFeeLedgerEntry: { create: vi.fn() },
  };
  const prismaMock = {
    leadPurchase: { updateMany: vi.fn(), findUnique: vi.fn() },
    leadFeeLedgerEntry: { createMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { tx, prismaMock };
});
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: prismaMock }));

import { PrismaLeadFeeRevenueLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";

const publication = { ...SNAPSHOT_DATA, publishedAt: PUBLISHED_AT, price: "100.00" };
const pending = pendingPurchaseFromPublication("p-1", "l-1", "pro-1", publication);
const purchaseRow = (over: Record<string, unknown> = {}) => ({
  id: "p-1",
  leadId: "l-1",
  professionalProfileId: "pro-1",
  status: "CONFIRMED",
  price: "100.00",
  currency: "EUR",
  pricingConfigVersion: pending.financialSnapshot.pricingConfigVersion,
  pricingRuleVersion: pending.financialSnapshot.pricingRuleVersion,
  leadPublishedAt: PUBLISHED_AT,
  taxAmount: "21.00",
  totalAmount: "121.00",
  taxPolicyVersion: pending.financialSnapshot.taxPolicyVersion,
  paymentReference: "pi_1",
  confirmedAt: NOW,
  failedAt: null,
  cancelledAt: null,
  refundedAt: null,
  revokedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
});

describe("M149 — PrismaLeadPurchaseRepository.transition with a ledger source", () => {
  const repo = new PrismaLeadPurchaseRepository();

  it("runs the conditional status write and the ledger insert in ONE transaction, with decimal-string amounts", async () => {
    tx.leadPurchase.updateMany.mockResolvedValue({ count: 1 });
    tx.leadPurchase.findUnique.mockResolvedValue(purchaseRow());
    tx.leadFeeLedgerEntry.create.mockResolvedValue({});

    const record = await repo.transition("p-1", "PENDING_PAYMENT", "CONFIRMED", NOW, SOURCE);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.leadPurchase.updateMany).toHaveBeenCalledWith({ where: { id: "p-1", status: "PENDING_PAYMENT" }, data: { status: "CONFIRMED", confirmedAt: NOW } });
    expect(tx.leadFeeLedgerEntry.create).toHaveBeenCalledTimes(1);
    const data = tx.leadFeeLedgerEntry.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      leadPurchaseId: "p-1", leadId: "l-1", professionalProfileId: "pro-1", paymentReference: "pi_1", providerEventId: "evt_1",
      netFeeAmount: "100.00", taxAmount: "21.00", totalCollectedAmount: "121.00", currency: "EUR", paymentConfirmedAt: NOW,
    });
    expect(typeof data.totalCollectedAmount).toBe("string");
    // outside the transaction nothing is written
    expect(prismaMock.leadPurchase.updateMany).not.toHaveBeenCalled();
    expect(record?.status).toBe("CONFIRMED");
  });

  it("a lost race (count 0) returns null and writes NO entry", async () => {
    tx.leadPurchase.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.transition("p-1", "PENDING_PAYMENT", "CONFIRMED", NOW, SOURCE)).toBeNull();
    expect(tx.leadPurchase.findUnique).not.toHaveBeenCalled();
    expect(tx.leadFeeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("a ledger insert failure propagates out of the transaction (so Prisma rolls the status write back)", async () => {
    tx.leadPurchase.updateMany.mockResolvedValue({ count: 1 });
    tx.leadPurchase.findUnique.mockResolvedValue(purchaseRow());
    tx.leadFeeLedgerEntry.create.mockRejectedValue(new Error("unique violation"));
    await expect(repo.transition("p-1", "PENDING_PAYMENT", "CONFIRMED", NOW, SOURCE)).rejects.toThrow("unique violation");
  });

  it("an unbuildable entry (e.g. snapshot without tax) aborts with the domain error before any insert", async () => {
    tx.leadPurchase.updateMany.mockResolvedValue({ count: 1 });
    tx.leadPurchase.findUnique.mockResolvedValue(purchaseRow({ taxAmount: null, totalAmount: null, taxPolicyVersion: null }));
    await expect(repo.transition("p-1", "PENDING_PAYMENT", "CONFIRMED", NOW, SOURCE)).rejects.toMatchObject({ code: "LEAD_FEE_LEDGER_ENTRY_INVALID" });
    expect(tx.leadFeeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("without a ledger source the behaviour is exactly the pre-M149 single conditional update (no transaction, no entry)", async () => {
    prismaMock.leadPurchase.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.leadPurchase.findUnique.mockResolvedValue(purchaseRow());
    await repo.transition("p-1", "PENDING_PAYMENT", "CONFIRMED", NOW);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.leadFeeLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.leadFeeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("a ledger source is rejected for any non-CONFIRMED target, and invalid transitions still throw first", async () => {
    await expect(repo.transition("p-1", "PENDING_PAYMENT", "CANCELLED", NOW, SOURCE)).rejects.toThrow(/only valid for the CONFIRMED/);
    await expect(repo.transition("p-1", "FAILED", "CONFIRMED", NOW, SOURCE)).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("M149 — PrismaLeadFeeRevenueLedgerRepository.recordIfAbsent", () => {
  const repo = new PrismaLeadFeeRevenueLedgerRepository();
  const entry = buildLeadFeeRevenueLedgerEntry(
    { ...pending, status: "CONFIRMED", paymentReference: "pi_1", confirmedAt: NOW },
    SOURCE,
  );
  const stored = (over: Record<string, unknown> = {}) => ({
    id: "le-1", ...entry, netFeeAmount: "100", taxAmount: "21", totalCollectedAmount: "121", recordedAt: NOW, ...over,
  });

  it("inserts with ON CONFLICT DO NOTHING semantics (skipDuplicates) and reports created=true; decimals normalised", async () => {
    prismaMock.leadFeeLedgerEntry.createMany.mockResolvedValue({ count: 1 });
    prismaMock.leadFeeLedgerEntry.findUnique.mockResolvedValue(stored());
    const result = await repo.recordIfAbsent(entry);
    expect(prismaMock.leadFeeLedgerEntry.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ paymentReference: "pi_1" })], skipDuplicates: true });
    expect(result.created).toBe(true);
    expect(result.entry.totalCollectedAmount).toBe("121.00");
  });

  it("an existing identical entry -> created=false (idempotent, nothing overwritten)", async () => {
    prismaMock.leadFeeLedgerEntry.createMany.mockResolvedValue({ count: 0 });
    prismaMock.leadFeeLedgerEntry.findUnique.mockResolvedValue(stored({ providerEventId: "evt_earlier" }));
    const result = await repo.recordIfAbsent(entry);
    expect(result.created).toBe(false);
    expect(result.entry.providerEventId).toBe("evt_earlier");
  });

  it("an existing entry with different facts, or a skipped insert with no entry for the purchase, throws a conflict", async () => {
    prismaMock.leadFeeLedgerEntry.createMany.mockResolvedValue({ count: 0 });
    prismaMock.leadFeeLedgerEntry.findUnique.mockResolvedValue(stored({ totalCollectedAmount: "99" }));
    await expect(repo.recordIfAbsent(entry)).rejects.toBeInstanceOf(LeadFeeLedgerConflictError);
    prismaMock.leadFeeLedgerEntry.findUnique.mockResolvedValue(null);
    await expect(repo.recordIfAbsent(entry)).rejects.toBeInstanceOf(LeadFeeLedgerConflictError);
  });

  it("database errors propagate", async () => {
    prismaMock.leadFeeLedgerEntry.createMany.mockRejectedValue(new Error("connection lost"));
    await expect(repo.recordIfAbsent(entry)).rejects.toThrow("connection lost");
  });

  it("exposes no update/delete operation", () => {
    expect(Object.getOwnPropertyNames(PrismaLeadFeeRevenueLedgerRepository.prototype).sort()).toEqual(["constructor", "findByLeadPurchaseId", "recordIfAbsent"]);
  });
});
