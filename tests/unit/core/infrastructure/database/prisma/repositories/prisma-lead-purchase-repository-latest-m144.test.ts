import { beforeEach, describe, expect, it, vi } from "vitest";

/** Module 144 — PrismaLeadPurchaseRepository.findLatestByLeadAndProfessional against a mocked Prisma client. */
const { leadPurchase } = vi.hoisted(() => ({ leadPurchase: { findFirst: vi.fn() } }));
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: { leadPurchase } }));

import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";

const now = new Date("2026-10-10T10:00:00.000Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "lp-1",
  leadId: "lead-1",
  professionalProfileId: "pro-1",
  status: "FAILED",
  price: "100.00",
  currency: "EUR",
  pricingConfigVersion: "c1",
  pricingRuleVersion: "r1",
  leadPublishedAt: now,
  taxAmount: "21.00",
  totalAmount: "121.00",
  taxPolicyVersion: "lead-fee-tax-policy-v1",
  paymentReference: "pi_1",
  confirmedAt: null,
  failedAt: now,
  cancelledAt: null,
  refundedAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("PrismaLeadPurchaseRepository.findLatestByLeadAndProfessional (M144)", () => {
  it("is a read scoped by lead AND professional profile, newest first, in ANY status", async () => {
    leadPurchase.findFirst.mockResolvedValue(row());
    const record = await new PrismaLeadPurchaseRepository().findLatestByLeadAndProfessional("lead-1", "pro-1");
    const args = leadPurchase.findFirst.mock.calls[0]![0] as { where: Record<string, unknown>; orderBy: unknown };
    expect(args.where).toEqual({ leadId: "lead-1", professionalProfileId: "pro-1" });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(record).toMatchObject({ id: "lp-1", status: "FAILED" });
    expect(record?.financialSnapshot).toMatchObject({ feeAmount: "100.00", taxAmount: "21.00", totalAmount: "121.00" });
  });

  it("returns null when the professional has no purchase of the lead", async () => {
    leadPurchase.findFirst.mockResolvedValue(null);
    expect(await new PrismaLeadPurchaseRepository().findLatestByLeadAndProfessional("lead-1", "pro-1")).toBeNull();
  });
});
