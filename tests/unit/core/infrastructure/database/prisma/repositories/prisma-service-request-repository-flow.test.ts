import { beforeEach, describe, expect, it, vi } from "vitest";

const address = { create: vi.fn() };
const serviceRequest = { create: vi.fn() };
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: { address, serviceRequest } }));

const row = {
  id: "sr-1", customerId: "c", categoryId: "cat", title: "t", description: "d", status: "PUBLISHED", urgency: "MEDIUM", budgetMin: null, budgetMax: null,
  expiresAt: null, createdAt: new Date(), updatedAt: new Date(), category: { name: "n", slug: "s" },
  address: { line1: "l", line2: null, city: "c", province: null, postalCode: "p", country: "ES", latitude: null, longitude: null }, photos: [],
};
const data = { categoryId: "cat", title: "t", description: "d", urgency: "MEDIUM" as const, budgetMin: null, budgetMax: null, location: row.address };

async function repo() {
  const { PrismaServiceRequestRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-service-request-repository");
  return new PrismaServiceRequestRepository();
}

describe("PrismaServiceRequestRepository.create flowVersion (Module 125)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    address.create.mockResolvedValue({ id: "addr" });
    serviceRequest.create.mockResolvedValue(row);
  });

  it("persists LEGACY_QUOTE_PAYMENT explicitly when no flow is given (legacy path unchanged)", async () => {
    await (await repo()).create("c", "u", data);
    expect(serviceRequest.create.mock.calls[0]![0].data.flowVersion).toBe("LEGACY_QUOTE_PAYMENT");
  });

  it("persists LEAD_V1 when the Lead Marketplace entry asks for it", async () => {
    await (await repo()).create("c", "u", { ...data, flowVersion: "LEAD_V1" });
    expect(serviceRequest.create.mock.calls[0]![0].data.flowVersion).toBe("LEAD_V1");
  });
});
