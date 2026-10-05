import { beforeEach, describe, expect, it, vi } from "vitest";

const forbidden = (name: string) => new Proxy({}, { get: () => () => { throw new Error(`${name} must not be touched`); } });
const tx = {
  serviceRequest: { update: vi.fn() },
  lead: { updateMany: vi.fn() },
  leadPurchase: forbidden("leadPurchase"),
  quote: forbidden("quote"),
  payment: forbidden("payment"),
  commission: forbidden("commission"),
  payout: forbidden("payout"),
};
const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: { $transaction } }));

async function repo() {
  const { PrismaServiceRequestRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-service-request-repository");
  return new PrismaServiceRequestRepository();
}

describe("PrismaServiceRequestRepository.updateStatus — Module 130 lead propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.lead.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each([
    ["CANCELLED", "CANCELLED"],
    ["EXPIRED", "EXPIRED"],
    ["COMPLETED", "CLOSED"],
  ] as const)("request -> %s moves the request's own LEAD_V1 lead to %s in ONE transaction", async (status, leadStatus) => {
    await (await repo()).updateStatus("sr-1", status);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.serviceRequest.update).toHaveBeenCalledWith({ where: { id: "sr-1" }, data: { status } });
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: { serviceRequestId: "sr-1", status: { in: ["DRAFT", "PUBLISHED"] }, serviceRequest: { flowVersion: "LEAD_V1" } },
      data: { status: leadStatus },
    });
  });

  it("is status-conditional, so repeated propagation matches no terminal lead and is harmless", async () => {
    tx.lead.updateMany.mockResolvedValue({ count: 0 });
    const r = await repo();
    await expect(r.updateStatus("sr-1", "CANCELLED")).resolves.toBeUndefined();
    await expect(r.updateStatus("sr-1", "CANCELLED")).resolves.toBeUndefined();
    for (const call of tx.lead.updateMany.mock.calls) expect(call[0].where.status.in).not.toContain("CANCELLED");
  });

  it("is scoped to the given request only (another request's lead is never targeted)", async () => {
    await (await repo()).updateStatus("sr-1", "EXPIRED");
    expect(tx.lead.updateMany.mock.calls[0]![0].where.serviceRequestId).toBe("sr-1");
  });

  it.each(["PUBLISHED", "DRAFT"] as const)("request -> %s leaves the lead alone", async (status) => {
    await (await repo()).updateStatus("sr-1", status);
    expect(tx.serviceRequest.update).toHaveBeenCalled();
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it("only writes lead.status and never touches LeadPurchase or legacy financial models", async () => {
    await (await repo()).updateStatus("sr-1", "CANCELLED");
    expect(Object.keys(tx.lead.updateMany.mock.calls[0]![0].data)).toEqual(["status"]);
  });

  it("a failing lead write rejects the whole update (transaction rolls back together)", async () => {
    tx.lead.updateMany.mockRejectedValue(new Error("boom"));
    await expect((await repo()).updateStatus("sr-1", "CANCELLED")).rejects.toThrow("boom");
  });
});
