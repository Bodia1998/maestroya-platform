import { Decimal } from "@prisma/client/runtime/library";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lead = { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() };

function forbidden(name: string) {
  return new Proxy({}, { get: () => () => { throw new Error(`${name} must not be touched`); } });
}

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    lead,
    leadPurchase: forbidden("leadPurchase"),
    quote: forbidden("quote"),
    payment: forbidden("payment"),
    commission: forbidden("commission"),
    payout: forbidden("payout"),
    invoice: forbidden("invoice"),
  },
}));

const PUBLISHED_AT = new Date("2026-10-06T10:00:00.000Z");
const row = {
  id: "lead-1",
  status: "PUBLISHED",
  maxBuyers: 1,
  publishedAt: PUBLISHED_AT,
  publicationPrice: new Decimal("18"),
  publicationCurrency: "EUR",
  publicationEstimatedJobValue: new Decimal("150"),
  publicationPricingRate: new Decimal("0.12"),
  publicationPricingConfidence: "LOW",
  publicationPricingConfigVersion: "cfg",
  publicationJobValueRuleVersion: "jv",
  publicationPricingRuleVersion: "pr",
  publicationBuyerPolicyVersion: "lead-buyer-policy-pilot-v1",
  serviceRequest: {
    title: "Fuga",
    description: "Baño",
    categoryId: "cat-1",
    urgency: "HIGH",
    flowVersion: "LEAD_V1",
    status: "PUBLISHED",
    deletedAt: null,
    category: { name: "Fontanería" },
    address: { city: "Madrid", province: "Madrid", latitude: 40.4, longitude: -3.7 },
    customer: { userId: "owner-user" },
  },
};

async function repo() {
  const { PrismaLeadFeedRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-feed-repository");
  return new PrismaLeadFeedRepository();
}

describe("PrismaLeadFeedRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters at query level to PUBLISHED lead, open non-deleted LEAD_V1 request and a present snapshot", async () => {
    lead.findMany.mockResolvedValue([row]);
    await (await repo()).findPage({ categoryIds: ["cat-1"], excludeCustomerUserId: "me", after: null, take: 10 });
    const arg = lead.findMany.mock.calls[0]![0];
    expect(arg.where.status).toBe("PUBLISHED");
    expect(arg.where.serviceRequest).toMatchObject({
      flowVersion: "LEAD_V1",
      status: "PUBLISHED",
      deletedAt: null,
      categoryId: { in: ["cat-1"] },
      customer: { userId: { not: "me" } },
    });
    for (const col of ["publishedAt", "publicationPrice", "publicationCurrency", "publicationEstimatedJobValue", "publicationPricingRate", "publicationPricingConfidence", "publicationPricingConfigVersion", "publicationJobValueRuleVersion", "publicationPricingRuleVersion", "publicationBuyerPolicyVersion", "maxBuyers"]) {
      expect(arg.where[col], col).toEqual({ not: null });
    }
    expect(arg.where.OR).toBeUndefined();
    expect(arg.take).toBe(10);
  });

  it("orders deterministically by (publishedAt DESC, id DESC) and applies an exclusive keyset bound", async () => {
    lead.findMany.mockResolvedValue([]);
    const after = { publishedAt: PUBLISHED_AT, leadId: "lead-9" };
    await (await repo()).findPage({ categoryIds: ["cat-1"], excludeCustomerUserId: "me", after, take: 5 });
    const arg = lead.findMany.mock.calls[0]![0];
    expect(arg.orderBy).toEqual([{ publishedAt: "desc" }, { id: "desc" }]);
    expect(arg.where.OR).toEqual([{ publishedAt: { lt: PUBLISHED_AT } }, { publishedAt: PUBLISHED_AT, id: { lt: "lead-9" } }]);
  });

  it("is a no-op for no categories or a non-positive page", async () => {
    const r = await repo();
    expect(await r.findPage({ categoryIds: [], excludeCustomerUserId: "me", after: null, take: 5 })).toEqual([]);
    expect(await r.findPage({ categoryIds: ["c"], excludeCustomerUserId: "me", after: null, take: 0 })).toEqual([]);
    expect(lead.findMany).not.toHaveBeenCalled();
  });

  it("maps the snapshot through exact decimal strings (no JS numbers) and exposes policy inputs", async () => {
    lead.findMany.mockResolvedValue([row]);
    const [c] = await (await repo()).findPage({ categoryIds: ["cat-1"], excludeCustomerUserId: "me", after: null, take: 5 });
    expect(c).toMatchObject({
      leadId: "lead-1",
      position: { publishedAt: PUBLISHED_AT, leadId: "lead-1" },
      leadStatus: "PUBLISHED",
      flowVersion: "LEAD_V1",
      requestStatus: "PUBLISHED",
      requestDeleted: false,
      customerUserId: "owner-user",
    });
    expect(c!.publication).toMatchObject({ price: "18.00", currency: "EUR", estimatedJobValue: "150.00", pricingRate: "0.12", maxBuyers: 1, publishedAt: PUBLISHED_AT });
    expect(typeof (c!.publication as { price: unknown }).price).toBe("string");
  });

  it("does not validate or throw on a malformed snapshot value: it is passed on for the domain policy to reject", async () => {
    lead.findMany.mockResolvedValue([{ ...row, publicationPrice: { toString: () => "garbage" } }]);
    const [c] = await (await repo()).findPage({ categoryIds: ["cat-1"], excludeCustomerUserId: "me", after: null, take: 5 });
    expect((c!.publication as { price: string }).price).toBe("garbage");
  });

  it("selects an explicit column list: no street address, postal code, email, phone, purchases, payments", async () => {
    lead.findMany.mockResolvedValue([row]);
    await (await repo()).findPage({ categoryIds: ["cat-1"], excludeCustomerUserId: "me", after: null, take: 5 });
    const select = lead.findMany.mock.calls[0]![0].select;
    expect(select.serviceRequest.select.address.select).toEqual({ city: true, province: true, latitude: true, longitude: true });
    expect(select.serviceRequest.select.customer.select).toEqual({ userId: true });
    const flat = JSON.stringify(select);
    for (const bad of ["line1", "line2", "postalCode", "email", "phone", "purchases", "passwordHash", "payment", "quote"]) expect(flat).not.toContain(bad);
  });

  it("never writes", async () => {
    lead.findMany.mockResolvedValue([row]);
    await (await repo()).findPage({ categoryIds: ["cat-1"], excludeCustomerUserId: "me", after: null, take: 5 });
    expect(lead.updateMany).not.toHaveBeenCalled();
    expect(lead.update).not.toHaveBeenCalled();
    expect(lead.create).not.toHaveBeenCalled();
  });
});
