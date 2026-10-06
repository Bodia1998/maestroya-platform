import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SNAPSHOT_DATA } from "../../../../../../test-utils/lead-publication-fixtures";

const lead = { updateMany: vi.fn(), findUnique: vi.fn() };
const forbidden = (name: string) => new Proxy({}, { get: () => () => { throw new Error(`${name} must not be touched`); } });

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: { lead, leadPurchase: forbidden("leadPurchase"), quote: forbidden("quote"), payment: forbidden("payment"), commission: forbidden("commission"), payout: forbidden("payout"), invoice: forbidden("invoice") },
}));

const now = new Date("2026-10-03T10:00:00Z");
const row = (patch: Record<string, unknown> = {}) => ({
  id: "lead-1", serviceRequestId: "sr-1", status: "PUBLISHED", maxBuyers: 2, createdAt: now, updatedAt: now, serviceRequest: { flowVersion: "LEAD_V1" },
  publishedAt: now,
  publicationPrice: new Prisma.Decimal("18"),
  publicationCurrency: "EUR",
  publicationEstimatedJobValue: new Prisma.Decimal("150.5"),
  publicationPricingRate: new Prisma.Decimal("0.12"),
  publicationPricingConfidence: "LOW",
  publicationPricingConfigVersion: "lead-pricing-test-config-v1",
  publicationJobValueRuleVersion: "job-value-test-v1",
  publicationPricingRuleVersion: "lead-pricing-test-v1",
  publicationBuyerPolicyVersion: "lead-buyer-policy-test-v1",
  ...patch,
});
const draftRow = () => row({ status: "DRAFT", maxBuyers: null, publishedAt: null, publicationPrice: null, publicationCurrency: null, publicationEstimatedJobValue: null, publicationPricingRate: null, publicationPricingConfidence: null, publicationPricingConfigVersion: null, publicationJobValueRuleVersion: null, publicationPricingRuleVersion: null, publicationBuyerPolicyVersion: null });

async function repo() {
  const { PrismaLeadRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-repository");
  return new PrismaLeadRepository();
}

describe("PrismaLeadRepository.publish (Module 133)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes status + snapshot + maxBuyers in ONE conditional updateMany (DRAFT, no snapshot yet, open non-deleted LEAD_V1 request)", async () => {
    lead.updateMany.mockResolvedValue({ count: 1 });
    lead.findUnique.mockResolvedValue(row());
    const result = await (await repo()).publish("lead-1", SNAPSHOT_DATA);
    expect(lead.updateMany).toHaveBeenCalledTimes(1);
    const arg = lead.updateMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ id: "lead-1", status: "DRAFT", publishedAt: null, serviceRequest: { flowVersion: "LEAD_V1", deletedAt: null, status: "PUBLISHED" } });
    expect(arg.data).toMatchObject({
      status: "PUBLISHED",
      publicationPrice: "18.00",
      publicationCurrency: "EUR",
      publicationEstimatedJobValue: "150.00",
      publicationPricingRate: "0.12",
      publicationPricingConfidence: "LOW",
      publicationPricingConfigVersion: "lead-pricing-test-config-v1",
      publicationJobValueRuleVersion: "job-value-test-v1",
      publicationPricingRuleVersion: "lead-pricing-test-v1",
      publicationBuyerPolicyVersion: "lead-buyer-policy-test-v1",
      maxBuyers: 2,
    });
    expect(arg.data.publishedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ id: "lead-1", status: "PUBLISHED", flowVersion: "LEAD_V1", maxBuyers: 2 });
  });

  it("monetary snapshot values are passed as exact decimal strings (never numbers)", async () => {
    lead.updateMany.mockResolvedValue({ count: 1 });
    lead.findUnique.mockResolvedValue(row());
    await (await repo()).publish("lead-1", SNAPSHOT_DATA);
    const data = lead.updateMany.mock.calls[0]![0].data;
    for (const key of ["publicationPrice", "publicationEstimatedJobValue", "publicationPricingRate"]) expect(typeof data[key]).toBe("string");
  });

  it("returns null when no row matched (missing / not DRAFT / already published / request closed) and re-reads nothing", async () => {
    lead.updateMany.mockResolvedValue({ count: 0 });
    expect(await (await repo()).publish("lead-1", SNAPSHOT_DATA)).toBeNull();
    expect(lead.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid snapshot BEFORE any write (no partially published lead)", async () => {
    for (const bad of [{ ...SNAPSHOT_DATA, price: "0.00" }, { ...SNAPSHOT_DATA, currency: "USD" }, { ...SNAPSHOT_DATA, maxBuyers: 0 }, { ...SNAPSHOT_DATA, pricingConfigVersion: "" }]) {
      await expect((await repo()).publish("lead-1", bad as never)).rejects.toMatchObject({ code: "LEAD_PUBLICATION_REJECTED", reason: "SNAPSHOT_INVALID" });
    }
    expect(lead.updateMany).not.toHaveBeenCalled();
  });

  it("maps a stored snapshot to exact strings and the publication record", async () => {
    lead.findUnique.mockResolvedValue(row());
    const found = await (await repo()).findById("lead-1");
    expect(found?.publication).toEqual({ ...SNAPSHOT_DATA, estimatedJobValue: "150.50", publishedAt: now });
  });

  it("a DRAFT lead has no publication snapshot", async () => {
    lead.findUnique.mockResolvedValue(draftRow());
    expect((await (await repo()).findById("lead-1"))?.publication).toBeNull();
  });

  it("a partially stored snapshot is corruption, never silently 'no snapshot'", async () => {
    lead.findUnique.mockResolvedValue(row({ publicationCurrency: null }));
    await expect((await repo()).findById("lead-1")).rejects.toThrow(/incomplete publication snapshot/);
  });
});
