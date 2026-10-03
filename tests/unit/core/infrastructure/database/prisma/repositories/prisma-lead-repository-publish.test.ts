import { beforeEach, describe, expect, it, vi } from "vitest";

const lead = { updateMany: vi.fn(), findUnique: vi.fn() };
const forbidden = (name: string) => new Proxy({}, { get: () => () => { throw new Error(`${name} must not be touched`); } });

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: { lead, leadPurchase: forbidden("leadPurchase"), quote: forbidden("quote"), payment: forbidden("payment"), commission: forbidden("commission"), payout: forbidden("payout"), invoice: forbidden("invoice") },
}));

const now = new Date("2026-10-03T10:00:00Z");
const published = { id: "lead-1", serviceRequestId: "sr-1", status: "PUBLISHED", maxBuyers: null, createdAt: now, updatedAt: now, serviceRequest: { flowVersion: "LEAD_V1" } };

async function repo() {
  const { PrismaLeadRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-repository");
  return new PrismaLeadRepository();
}

describe("PrismaLeadRepository.publish", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions only a DRAFT row (status-conditional) and touches nothing else", async () => {
    lead.updateMany.mockResolvedValue({ count: 1 });
    lead.findUnique.mockResolvedValue(published);
    const result = await (await repo()).publish("lead-1");
    expect(lead.updateMany).toHaveBeenCalledWith({ where: { id: "lead-1", status: "DRAFT" }, data: { status: "PUBLISHED" } });
    expect(result).toMatchObject({ id: "lead-1", status: "PUBLISHED", flowVersion: "LEAD_V1", maxBuyers: null });
  });

  it("returns null when no DRAFT row was transitioned (missing / already published / closed)", async () => {
    lead.updateMany.mockResolvedValue({ count: 0 });
    expect(await (await repo()).publish("lead-1")).toBeNull();
    expect(lead.findUnique).not.toHaveBeenCalled();
  });

  it("never writes maxBuyers or any field other than status", async () => {
    lead.updateMany.mockResolvedValue({ count: 1 });
    lead.findUnique.mockResolvedValue(published);
    await (await repo()).publish("lead-1");
    expect(Object.keys(lead.updateMany.mock.calls[0]![0].data)).toEqual(["status"]);
  });
});
