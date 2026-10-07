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
const PUBLISHED_AT = new Date("2026-10-06T10:00:00.000Z");
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

import { SNAPSHOT_DATA } from "../../../../../../test-utils/lead-publication-fixtures";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";

const row = (over: Record<string, unknown> = {}) => ({
  id: "lp-1",
  leadId: "lead-1",
  professionalProfileId: "pro-1",
  status: "PENDING_PAYMENT",
  price: "18.00",
  currency: "EUR",
  pricingConfigVersion: SNAPSHOT_DATA.pricingConfigVersion,
  pricingRuleVersion: SNAPSHOT_DATA.pricingRuleVersion,
  leadPublishedAt: PUBLISHED_AT,
  taxAmount: null,
  totalAmount: null,
  taxPolicyVersion: null,
  confirmedAt: null,
  refundedAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});
const data = { leadId: "lead-1", professionalProfileId: "pro-1" };

/** What the locked `leads` SELECT returns for a legitimately published (M133) lead: numerics cast to text. */
const lockedLead = (over: Record<string, unknown> = {}) => ({
  status: "PUBLISHED",
  maxBuyers: 2,
  publishedAt: PUBLISHED_AT,
  publicationPrice: "18.00",
  publicationCurrency: "EUR",
  publicationEstimatedJobValue: "150.00",
  publicationPricingRate: "0.120000",
  publicationPricingConfidence: "LOW",
  publicationPricingConfigVersion: SNAPSHOT_DATA.pricingConfigVersion,
  publicationJobValueRuleVersion: SNAPSHOT_DATA.jobValueRuleVersion,
  publicationPricingRuleVersion: SNAPSHOT_DATA.pricingRuleVersion,
  publicationBuyerPolicyVersion: SNAPSHOT_DATA.buyerPolicyVersion,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initiate", () => {
  it("locks the lead row, then checks own duplicate, then capacity, then inserts (one transaction)", async () => {
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(async () => (order.push("lock"), [lockedLead()]));
    tx.leadPurchase.count.mockImplementation(async (args: { where: { professionalProfileId?: string } }) => {
      order.push(args.where.professionalProfileId ? "own" : "count");
      return args.where.professionalProfileId ? 0 : 1;
    });
    tx.leadPurchase.create.mockImplementation(async () => (order.push("insert"), row()));
    const r = await new PrismaLeadPurchaseRepository().initiate(data);
    expect(order).toEqual(["lock", "own", "count", "insert"]);
    expect(r).toMatchObject({ status: "PENDING_PAYMENT", price: 18 });
    for (const call of tx.leadPurchase.count.mock.calls) expect(call[0].where.status.in).toEqual(["PENDING_PAYMENT", "CONFIRMED"]);
  });

  it("Module 135: the purchase is created from the locked lead's publication snapshot (exact strings), with no caller price", async () => {
    tx.$queryRaw.mockResolvedValue([lockedLead()]);
    tx.leadPurchase.count.mockResolvedValue(0);
    tx.leadPurchase.create.mockResolvedValue(row());
    await new PrismaLeadPurchaseRepository().initiate({ ...data, price: 0.01, currency: "USD" } as never); // smuggled values are ignored
    expect(tx.leadPurchase.create.mock.calls[0]![0].data).toEqual({
      leadId: "lead-1",
      professionalProfileId: "pro-1",
      price: "18.00",
      currency: "EUR",
      pricingConfigVersion: SNAPSHOT_DATA.pricingConfigVersion,
      pricingRuleVersion: SNAPSHOT_DATA.pricingRuleVersion,
      leadPublishedAt: PUBLISHED_AT,
      // Module 136: IVA 21% computed from the locked snapshot fee (18.00), written with the insert
      taxAmount: "3.78",
      totalAmount: "21.78",
      taxPolicyVersion: "lead-fee-tax-policy-v1",
    });
    expect(typeof tx.leadPurchase.create.mock.calls[0]![0].data.price).toBe("string");
  });

  it("the locking SELECT casts every numeric snapshot column to text (money never passes through a JS number)", async () => {
    tx.$queryRaw.mockResolvedValue([lockedLead()]);
    tx.leadPurchase.count.mockResolvedValue(0);
    tx.leadPurchase.create.mockResolvedValue(row());
    await new PrismaLeadPurchaseRepository().initiate(data);
    const sql = (tx.$queryRaw.mock.calls[0]![0] as string[]).join("?");
    expect(sql).toContain("FOR UPDATE");
    for (const col of ["publicationPrice", "publicationEstimatedJobValue", "publicationPricingRate"]) expect(sql).toContain(`"${col}"::text`);
  });

  it("a NULL maxBuyers (incomplete buyer-policy snapshot) is never purchasable", async () => {
    tx.$queryRaw.mockResolvedValue([lockedLead({ maxBuyers: null })]);
    tx.leadPurchase.count.mockResolvedValue(0);
    tx.leadPurchase.create.mockResolvedValue(row());
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(tx.leadPurchase.create).not.toHaveBeenCalled();
  });

  it("rejects when the limit is reached, without inserting", async () => {
    tx.$queryRaw.mockResolvedValue([lockedLead({ maxBuyers: 2 })]);
    tx.leadPurchase.count.mockImplementation(async (args: { where: { professionalProfileId?: string } }) => (args.where.professionalProfileId ? 0 : 2));
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(LeadBuyerLimitReachedError);
    expect(tx.leadPurchase.create).not.toHaveBeenCalled();
  });

  it("the buyer's own active purchase is a DUPLICATE (not 'limit reached'), even when the lead is full", async () => {
    tx.$queryRaw.mockResolvedValue([lockedLead({ maxBuyers: 1 })]);
    tx.leadPurchase.count.mockResolvedValue(1);
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
    expect(tx.leadPurchase.create).not.toHaveBeenCalled();
  });

  it.each([[[]], [[lockedLead({ status: "DRAFT" })]], [[lockedLead({ status: "CLOSED" })]]])("missing / non-PUBLISHED lead -> LeadNotPurchasableError", async (rows) => {
    tx.$queryRaw.mockResolvedValue(rows);
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(tx.leadPurchase.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no snapshot at all (pre-M133 publication)", { publishedAt: null, publicationPrice: null, publicationCurrency: null, publicationEstimatedJobValue: null, publicationPricingRate: null, publicationPricingConfidence: null, publicationPricingConfigVersion: null, publicationJobValueRuleVersion: null, publicationPricingRuleVersion: null, publicationBuyerPolicyVersion: null, maxBuyers: null }],
    ["half-written snapshot", { publicationPricingRuleVersion: null }],
    ["zero price", { publicationPrice: "0.00" }],
    ["foreign currency", { publicationCurrency: "USD" }],
    ["missing publication timestamp", { publishedAt: null }],
  ])("a PUBLISHED lead with %s is never purchasable and nothing is inserted", async (_n, over) => {
    tx.$queryRaw.mockResolvedValue([lockedLead(over)]);
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(tx.leadPurchase.count).not.toHaveBeenCalled();
    expect(tx.leadPurchase.create).not.toHaveBeenCalled();
  });

  it("maps the partial unique index violation (P2002) to DuplicateActiveLeadPurchaseError", async () => {
    tx.$queryRaw.mockResolvedValue([lockedLead()]);
    tx.leadPurchase.count.mockResolvedValue(0);
    tx.leadPurchase.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    await expect(new PrismaLeadPurchaseRepository().initiate(data)).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
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
