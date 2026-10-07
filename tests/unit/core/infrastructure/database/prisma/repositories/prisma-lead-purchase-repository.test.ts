import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DuplicateActiveLeadPurchaseError, InvalidLeadPurchaseError } from "@/domain/services/lead-purchase";

/** Module 123 — PrismaLeadPurchaseRepository against a mocked Prisma client.
 *  Legacy financial models are tripwires: a LeadPurchase must never create a
 *  Payment, Commission, Payout, Invoice or Quote. */
const now = new Date("2026-10-02T10:00:00.000Z");
const leadPurchase = { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() };

function forbidden(name: string) {
  return new Proxy({}, { get: () => () => { throw new Error(`${name} must not be touched by the lead purchase repository`); } });
}

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    leadPurchase,
    payment: forbidden("payment"),
    commission: forbidden("commission"),
    payout: forbidden("payout"),
    invoice: forbidden("invoice"),
    quote: forbidden("quote"),
    financialLedgerEntry: forbidden("ledger"),
    $transaction: () => { throw new Error("no transaction expected"); },
  },
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: "lp-1",
  leadId: "lead-1",
  professionalProfileId: "pro-1",
  status: "PENDING_PAYMENT",
  price: "4.50",
  currency: "EUR",
  pricingConfigVersion: null,
  pricingRuleVersion: null,
  leadPublishedAt: null,
  taxAmount: null,
  totalAmount: null,
  confirmedAt: null,
  refundedAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

async function repo() {
  const { PrismaLeadPurchaseRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository");
  return new PrismaLeadPurchaseRepository();
}

describe("PrismaLeadPurchaseRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a PENDING_PAYMENT purchase (status left to the column default) with a numeric price", async () => {
    leadPurchase.create.mockResolvedValue(row());
    const result = await (await repo()).create({ leadId: "lead-1", professionalProfileId: "pro-1", price: 4.5 });
    expect(leadPurchase.create.mock.calls[0]![0]!.data).toEqual({
      leadId: "lead-1",
      professionalProfileId: "pro-1",
      price: 4.5,
      currency: "EUR",
    });
    expect(result).toMatchObject({ status: "PENDING_PAYMENT", price: 4.5, currency: "EUR", confirmedAt: null });
  });

  it("a created purchase grants no access: no confirmation timestamp, not CONFIRMED", async () => {
    leadPurchase.create.mockResolvedValue(row());
    const result = await (await repo()).create({ leadId: "lead-1", professionalProfileId: "pro-1", price: 0 });
    expect(result.status).not.toBe("CONFIRMED");
    expect(result.confirmedAt).toBeNull();
  });

  it.each([-1, Number.NaN, 1.234, 1e12])("rejects invalid price %s before touching the database", async (price) => {
    await expect((await repo()).create({ leadId: "l", professionalProfileId: "p", price })).rejects.toBeInstanceOf(InvalidLeadPurchaseError);
    expect(leadPurchase.create).not.toHaveBeenCalled();
  });

  it("rejects a non-EUR currency", async () => {
    await expect((await repo()).create({ leadId: "l", professionalProfileId: "p", price: 5, currency: "USD" })).rejects.toBeInstanceOf(
      InvalidLeadPurchaseError,
    );
    expect(leadPurchase.create).not.toHaveBeenCalled();
  });

  it("maps the partial-unique violation to DuplicateActiveLeadPurchaseError", async () => {
    leadPurchase.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    await expect((await repo()).create({ leadId: "l", professionalProfileId: "p", price: 5 })).rejects.toBeInstanceOf(
      DuplicateActiveLeadPurchaseError,
    );
  });

  it("does not swallow a foreign-key failure (unknown lead / professional)", async () => {
    const fk = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" });
    leadPurchase.create.mockRejectedValue(fk);
    await expect((await repo()).create({ leadId: "x", professionalProfileId: "p", price: 5 })).rejects.toBe(fk);
  });

  it("findActive only considers PENDING_PAYMENT / CONFIRMED", async () => {
    leadPurchase.findFirst.mockResolvedValue(row());
    await (await repo()).findActiveByLeadAndProfessional("lead-1", "pro-1");
    expect(leadPurchase.findFirst.mock.calls[0]![0]!.where).toEqual({
      leadId: "lead-1",
      professionalProfileId: "pro-1",
      status: { in: ["PENDING_PAYMENT", "CONFIRMED"] },
    });
  });

  it("findConfirmed is scoped to the professional and CONFIRMED only", async () => {
    leadPurchase.findFirst.mockResolvedValueOnce(row({ status: "CONFIRMED", confirmedAt: now })).mockResolvedValueOnce(null);
    const r = await repo();
    expect((await r.findConfirmedByLeadAndProfessional("lead-1", "pro-1"))?.status).toBe("CONFIRMED");
    expect(leadPurchase.findFirst.mock.calls[0]![0]!.where).toEqual({ leadId: "lead-1", professionalProfileId: "pro-1", status: "CONFIRMED" });
    expect(await r.findConfirmedByLeadAndProfessional("lead-1", "other-pro")).toBeNull();
  });

  it("findById maps Decimal strings to numbers and null when absent", async () => {
    leadPurchase.findUnique.mockResolvedValueOnce(row({ price: "12.34" })).mockResolvedValueOnce(null);
    const r = await repo();
    expect((await r.findById("lp-1"))?.price).toBe(12.34);
    expect(await r.findById("nope")).toBeNull();
  });

  it("rejects a persisted unknown status", async () => {
    leadPurchase.findUnique.mockResolvedValue(row({ status: "WHAT" }));
    await expect((await repo()).findById("lp-1")).rejects.toThrow(/Unknown LeadPurchase status/);
  });

  it("selects no customer data (record has only purchase columns)", async () => {
    leadPurchase.findUnique.mockResolvedValue(row());
    const result = await (await repo()).findById("lp-1");
    expect(JSON.stringify(leadPurchase.findUnique.mock.calls[0]![0]!.select)).not.toMatch(/email|phone|address|customer|lead:|professional:/i);
    expect(Object.keys(result!).sort()).toEqual([
      "confirmedAt", "createdAt", "currency", "financialSnapshot", "id", "leadId", "price", "professionalProfileId", "refundedAt", "revokedAt", "status", "updatedAt",
    ]);
  });

  it("Module 135: maps the stored Decimals to an exact financial snapshot (strings, no float), tax neutral by default", async () => {
    const published = new Date("2026-10-06T10:00:00Z");
    leadPurchase.findUnique.mockResolvedValue(
      row({ price: "18", pricingConfigVersion: "cfg-v1", pricingRuleVersion: "rule-v1", leadPublishedAt: published }),
    );
    const result = await (await repo()).findById("lp-1");
    expect(result!.financialSnapshot).toEqual({
      feeAmount: "18.00",
      currency: "EUR",
      taxAmount: null,
      totalAmount: null,
      pricingConfigVersion: "cfg-v1",
      pricingRuleVersion: "rule-v1",
      leadPublishedAt: published,
    });
    expect(typeof result!.financialSnapshot.feeAmount).toBe("string");
  });

  it("Module 135: a legacy purchase (pre-snapshot) maps with null provenance; nothing is fabricated", async () => {
    leadPurchase.findUnique.mockResolvedValue(row({ price: "4.50" }));
    const { financialSnapshot } = (await (await repo()).findById("lp-1"))!;
    expect(financialSnapshot).toMatchObject({ feeAmount: "4.50", pricingConfigVersion: null, pricingRuleVersion: null, leadPublishedAt: null, taxAmount: null, totalAmount: null });
  });

  it("Module 135: stored tax/total are passed through exactly when present (written by a later module)", async () => {
    leadPurchase.findUnique.mockResolvedValue(row({ price: "18.00", taxAmount: "3.78", totalAmount: "21.78" }));
    const { financialSnapshot } = (await (await repo()).findById("lp-1"))!;
    expect(financialSnapshot).toMatchObject({ taxAmount: "3.78", totalAmount: "21.78" });
  });
});
