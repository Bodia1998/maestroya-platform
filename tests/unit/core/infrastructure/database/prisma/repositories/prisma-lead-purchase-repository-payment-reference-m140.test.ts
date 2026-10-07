import { beforeEach, describe, expect, it, vi } from "vitest";

/** Module 140 — PrismaLeadPurchaseRepository.recordPaymentReference against a mocked Prisma client. */
const { leadPurchase } = vi.hoisted(() => ({ leadPurchase: { updateMany: vi.fn(), findUnique: vi.fn() } }));
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: { leadPurchase } }));

import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";

const now = new Date("2026-10-10T10:00:00.000Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "lp-1",
  leadId: "lead-1",
  professionalProfileId: "pro-1",
  status: "PENDING_PAYMENT",
  price: "100.00",
  currency: "EUR",
  pricingConfigVersion: "c1",
  pricingRuleVersion: "r1",
  leadPublishedAt: now,
  taxAmount: "21.00",
  totalAmount: "121.00",
  taxPolicyVersion: "lead-fee-tax-policy-v1",
  paymentReference: null,
  confirmedAt: null,
  failedAt: null,
  cancelledAt: null,
  refundedAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("PrismaLeadPurchaseRepository.recordPaymentReference (M140)", () => {
  it("is a status- and write-once-conditional update that writes ONLY paymentReference", async () => {
    leadPurchase.updateMany.mockResolvedValue({ count: 1 });
    leadPurchase.findUnique.mockResolvedValue(row({ paymentReference: "pi_1" }));
    const record = await new PrismaLeadPurchaseRepository().recordPaymentReference("lp-1", "pi_1");
    expect(leadPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: "lp-1", status: "PENDING_PAYMENT", paymentReference: null },
      data: { paymentReference: "pi_1" },
    });
    expect(record).toMatchObject({ id: "lp-1", status: "PENDING_PAYMENT", paymentReference: "pi_1" });
    expect(record?.financialSnapshot).toMatchObject({ feeAmount: "100.00", taxAmount: "21.00", totalAmount: "121.00" });
  });

  it("returns null (and reads nothing) when no row matched: missing, terminal, or a reference already set", async () => {
    leadPurchase.updateMany.mockResolvedValue({ count: 0 });
    expect(await new PrismaLeadPurchaseRepository().recordPaymentReference("lp-1", "pi_1")).toBeNull();
    expect(leadPurchase.findUnique).not.toHaveBeenCalled();
  });

  it("maps a missing reference to null on every read path", async () => {
    leadPurchase.findUnique.mockResolvedValue(row());
    expect((await new PrismaLeadPurchaseRepository().findById("lp-1"))?.paymentReference).toBeNull();
  });
});
