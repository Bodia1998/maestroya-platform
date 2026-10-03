import { beforeEach, describe, expect, it, vi } from "vitest";

const lead = { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() };

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

const row = {
  id: "lead-1",
  createdAt: new Date("2026-10-03T10:00:00Z"),
  serviceRequest: {
    title: "Fuga",
    description: "Baño",
    categoryId: "cat-1",
    urgency: "HIGH",
    category: { name: "Fontanería" },
    address: { city: "Madrid", province: "Madrid", latitude: 40.4, longitude: -3.7 },
    customer: { userId: "owner-user" },
  },
};

async function repo() {
  const { PrismaLeadPreviewRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-preview-repository");
  return new PrismaLeadPreviewRepository();
}

const VISIBLE = { status: "PUBLISHED", serviceRequest: expect.objectContaining({ flowVersion: "LEAD_V1", status: "PUBLISHED", deletedAt: null }) };

describe("PrismaLeadPreviewRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("findPublishedById filters to PUBLISHED lead on an open, non-deleted LEAD_V1 request", async () => {
    lead.findFirst.mockResolvedValue(row);
    const result = await (await repo()).findPublishedById("lead-1");
    expect(lead.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "lead-1", ...VISIBLE }) }));
    expect(result).toMatchObject({ leadId: "lead-1", city: "Madrid", categoryName: "Fontanería", customerUserId: "owner-user" });
  });

  it("findPublishedByCategoryIds filters the same way and is a no-op for no categories", async () => {
    lead.findMany.mockResolvedValue([row]);
    const r = await repo();
    expect(await r.findPublishedByCategoryIds([])).toEqual([]);
    expect(lead.findMany).not.toHaveBeenCalled();
    await r.findPublishedByCategoryIds(["cat-1"]);
    const arg = lead.findMany.mock.calls[0]![0];
    expect(arg.where.status).toBe("PUBLISHED");
    expect(arg.where.serviceRequest).toMatchObject({ flowVersion: "LEAD_V1", status: "PUBLISHED", deletedAt: null, categoryId: { in: ["cat-1"] } });
  });

  it("returns null for a lead that is not visible", async () => {
    lead.findFirst.mockResolvedValue(null);
    expect(await (await repo()).findPublishedById("x")).toBeNull();
  });

  it("selects an explicit column list: no street address, postal code, email, phone, purchases", async () => {
    lead.findFirst.mockResolvedValue(row);
    await (await repo()).findPublishedById("lead-1");
    const select = lead.findFirst.mock.calls[0]![0].select;
    const flat = JSON.stringify(select);
    expect(select.serviceRequest.select.address.select).toEqual({ city: true, province: true, latitude: true, longitude: true });
    expect(select.serviceRequest.select.customer.select).toEqual({ userId: true });
    for (const bad of ["line1", "line2", "postalCode", "email", "phone", "purchases", "passwordHash"]) {
      expect(flat).not.toContain(bad);
    }
  });
});
