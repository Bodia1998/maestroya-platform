import { beforeEach, describe, expect, it, vi } from "vitest";

import { LegacyFlowBoundaryError } from "@/domain/services/transaction-flow";

/**
 * Module 131 — lower-level bypass attempts. PrismaQuoteAcceptanceRepository
 * writes ServiceRequest.status = ACCEPTED directly (not via updateStatus) and
 * PrismaQuoteRepository.create is the only quote write path; both must refuse
 * a LEAD_V1 request on their own, even if the use-case guard is skipped.
 */
const tx = {
  serviceRequest: { findFirst: vi.fn(), updateMany: vi.fn() },
  quote: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  job: { create: vi.fn() },
  appointment: { create: vi.fn() },
};
const prismaMock = {
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  serviceRequest: { findUnique: vi.fn() },
  quote: { create: vi.fn() },
};
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: prismaMock }));

function noWrites() {
  expect(tx.quote.updateMany).not.toHaveBeenCalled();
  expect(tx.serviceRequest.updateMany).not.toHaveBeenCalled();
  expect(tx.job.create).not.toHaveBeenCalled();
  expect(tx.appointment.create).not.toHaveBeenCalled();
}

describe("PrismaQuoteAcceptanceRepository — direct ACCEPTED write is flow-guarded", () => {
  beforeEach(() => vi.clearAllMocks());

  async function repo() {
    const { PrismaQuoteAcceptanceRepository } =
      await import("@/infrastructure/database/prisma/repositories/prisma-quote-acceptance-repository");
    return new PrismaQuoteAcceptanceRepository();
  }

  it.each(["LEAD_V1", "SOMETHING_ELSE"])(
    "rejects a PUBLISHED %s request with no writes (no Job/Appointment/ACCEPTED)",
    async (flow) => {
      tx.serviceRequest.findFirst.mockResolvedValue({
        id: "sr-1",
        addressId: "a",
        status: "PUBLISHED",
        customerId: "c",
        flowVersion: flow,
      });
      await expect(
        (await repo()).acceptQuote({ quoteId: "q", serviceRequestId: "sr-1" }),
      ).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
      noWrites();
    },
  );

  it("reads flowVersion inside the same transaction", async () => {
    tx.serviceRequest.findFirst.mockResolvedValue({
      id: "sr-1",
      addressId: "a",
      status: "PUBLISHED",
      customerId: "c",
      flowVersion: "LEAD_V1",
    });
    await (
      await repo()
    )
      .acceptQuote({ quoteId: "q", serviceRequestId: "sr-1" })
      .catch(() => undefined);
    expect(tx.serviceRequest.findFirst.mock.calls[0]?.[0]?.select.flowVersion).toBe(true);
  });

  it("LEGACY request still accepts: ACCEPTED write is additionally conditioned on the legacy flow", async () => {
    const now = new Date();
    tx.serviceRequest.findFirst.mockResolvedValue({
      id: "sr-1",
      addressId: "a",
      status: "PUBLISHED",
      customerId: "c",
      flowVersion: "LEGACY_QUOTE_PAYMENT",
    });
    tx.quote.updateMany.mockResolvedValue({ count: 1 });
    tx.quote.findUniqueOrThrow.mockResolvedValue({
      professionalProfileId: "p",
      companyProfileId: null,
    });
    tx.serviceRequest.updateMany.mockResolvedValue({ count: 1 });
    const job = {
      id: "j",
      serviceRequestId: "sr-1",
      quoteId: "q",
      customerId: "c",
      professionalProfileId: "p",
      companyProfileId: null,
      status: "CREATED",
      createdAt: now,
      updatedAt: now,
    };
    tx.job.create.mockResolvedValue(job);
    tx.appointment.create.mockResolvedValue({
      id: "ap",
      jobId: "j",
      quoteId: "q",
      serviceRequestId: "sr-1",
      addressId: "a",
      professionalProfileId: "p",
      companyProfileId: null,
      status: "PENDING_SCHEDULE",
      scheduledStart: null,
      scheduledEnd: null,
      createdAt: now,
      updatedAt: now,
    });
    const result = await (await repo()).acceptQuote({ quoteId: "q", serviceRequestId: "sr-1" });
    expect(result.job.id).toBe("j");
    expect(tx.serviceRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "sr-1", status: "PUBLISHED", flowVersion: "LEGACY_QUOTE_PAYMENT" },
      data: { status: "ACCEPTED" },
    });
  });
});

describe("PrismaQuoteRepository.create — LEAD_V1 cannot persist a Quote", () => {
  beforeEach(() => vi.clearAllMocks());

  async function repo() {
    const { PrismaQuoteRepository } =
      await import("@/infrastructure/database/prisma/repositories/prisma-quote-repository");
    return new PrismaQuoteRepository();
  }
  const data = {
    serviceRequestId: "sr-1",
    professionalProfileId: "p",
    submittedByUserId: "u",
    totalAmount: 1,
    currency: "EUR",
    items: [],
  };

  it.each(["LEAD_V1", "SOMETHING_ELSE"])("rejects a %s request without writing", async (flow) => {
    prismaMock.serviceRequest.findUnique.mockResolvedValue({ flowVersion: flow });
    await expect((await repo()).create(data as never)).rejects.toBeInstanceOf(
      LegacyFlowBoundaryError,
    );
    expect(prismaMock.quote.create).not.toHaveBeenCalled();
  });

  it("fails closed when the request does not exist", async () => {
    prismaMock.serviceRequest.findUnique.mockResolvedValue(null);
    await expect((await repo()).create(data as never)).rejects.toThrow();
    expect(prismaMock.quote.create).not.toHaveBeenCalled();
  });

  it("LEGACY request proceeds to the write", async () => {
    prismaMock.serviceRequest.findUnique.mockResolvedValue({ flowVersion: "LEGACY_QUOTE_PAYMENT" });
    prismaMock.quote.create.mockRejectedValue(new Error("reached-write"));
    await expect((await repo()).create(data as never)).rejects.toThrow("reached-write");
  });
});
