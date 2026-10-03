import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DuplicateActiveLeadPurchaseError,
  InvalidLeadPurchaseTransitionError,
  LeadBuyerLimitReachedError,
  LeadNotPurchasableError,
} from "@/domain/services/lead-purchase";

/** Module 126 — PrismaLeadPurchaseRepository.initiate / transition against a mocked Prisma client. */
const now = new Date("2026-10-03T10:00:00.000Z");
const { tx, leadPurchase } = vi.hoisted(() => ({
  tx: { $queryRaw: vi.fn(), leadPurchase: { count: vi.fn(), create: vi.fn() } },
  leadPurchase: { updateMany: vi.fn(), findUnique: vi.fn() },
}));

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    leadPurchase,
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";

const row = (over: Record<string, unknown> = {}) => ({
  id: "lp-1",
  leadId: "lead-1",
  professionalProfileId: "pro-1",
  status: "PENDING_PAYMENT",
  price: "4.50",
  currency: "EUR",
  confirmedAt: null,
  refundedAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});
const data = { leadId: "lead-1", professionalProfileId: "pro-1", price: 4.5 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initiate", () => {
  it("locks the lead row, then counts, then inserts (in that order, one transaction)", async () => {
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(async () => (order.push("lock"), [{ status: "PUBLISHED", maxBuyers: 2 }]));
    tx.leadPurchase.count.mockImplementation(async () => (order.push("count"), 1));
    tx.leadPurchase.create.mockImplementation(async () => (order.push("insert"), row()));
    const r = await new PrismaLeadPurchaseRepository().initiate(data);
    expect(order).toEqual(["lock", "count", "insert"]);
    expect(r).toMatchObject({ status: "PENDING_PAYMENT", price: 4.5 });
    expect(tx.leadPurchase.count.mock.calls[0]![0].where.status.in).toEqual(["PENDING_PAYMENT", "CONFIRMED"]);
  });

  it("maxBuyers NULL is not enforced", async () => {
    tx.$queryRaw.mockResolvedValue([{ status: "PUBLISHED", maxBuyers: null }]);
    tx.leadPurchase.count.mockResolvedValue(999);
    tx.leadPurchase.create.mockResolvedValue(row());
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).resolves.toBeDefined();
  });

  it("rejects when the limit is reached, without inserting", async () => {
    tx.$queryRaw.mockResolvedValue([{ status: "PUBLISHED", maxBuyers: 2 }]);
    tx.leadPurchase.count.mockResolvedValue(2);
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(LeadBuyerLimitReachedError);
    expect(tx.leadPurchase.create).not.toHaveBeenCalled();
  });

  it.each([[[]], [[{ status: "DRAFT", maxBuyers: null }]], [[{ status: "CLOSED", maxBuyers: null }]]])("missing / non-PUBLISHED lead -> LeadNotPurchasableError", async (rows) => {
    tx.$queryRaw.mockResolvedValue(rows);
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(tx.leadPurchase.create).not.toHaveBeenCalled();
  });

  it("maps the partial unique index violation (P2002) to DuplicateActiveLeadPurchaseError", async () => {
    tx.$queryRaw.mockResolvedValue([{ status: "PUBLISHED", maxBuyers: null }]);
    tx.leadPurchase.count.mockResolvedValue(0);
    tx.leadPurchase.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
  });

  it("validates price/currency before touching the database", async () => {
    await expect(new PrismaLeadPurchaseRepository().initiate({ ...data, price: -1 })).rejects.toThrow();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("transition", () => {
  it("is a status-conditional updateMany that stamps the right timestamp", async () => {
    leadPurchase.updateMany.mockResolvedValue({ count: 1 });
    leadPurchase.findUnique.mockResolvedValue(row({ status: "CONFIRMED", confirmedAt: now }));
    const r = await new PrismaLeadPurchaseRepository().transition("lp-1", "PENDING_PAYMENT", "CONFIRMED", now);
    expect(leadPurchase.updateMany).toHaveBeenCalledWith({ where: { id: "lp-1", status: "PENDING_PAYMENT" }, data: { status: "CONFIRMED", confirmedAt: now } });
    expect(r?.status).toBe("CONFIRMED");

    leadPurchase.updateMany.mockResolvedValue({ count: 1 });
    await new PrismaLeadPurchaseRepository().transition("lp-1", "CONFIRMED", "REVOKED", now);
    expect(leadPurchase.updateMany).toHaveBeenLastCalledWith({ where: { id: "lp-1", status: "CONFIRMED" }, data: { status: "REVOKED", revokedAt: now } });

    await new PrismaLeadPurchaseRepository().transition("lp-1", "PENDING_PAYMENT", "FAILED", now);
    expect(leadPurchase.updateMany).toHaveBeenLastCalledWith({ where: { id: "lp-1", status: "PENDING_PAYMENT" }, data: { status: "FAILED" } });
  });

  it("returns null when no row was in `from` (lost race / missing)", async () => {
    leadPurchase.updateMany.mockResolvedValue({ count: 0 });
    expect(await new PrismaLeadPurchaseRepository().transition("lp-1", "PENDING_PAYMENT", "CONFIRMED", now)).toBeNull();
  });

  it("refuses an invalid transition without touching the database", async () => {
    await expect(new PrismaLeadPurchaseRepository().transition("lp-1", "FAILED", "CONFIRMED", now)).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    expect(leadPurchase.updateMany).not.toHaveBeenCalled();
  });
});
