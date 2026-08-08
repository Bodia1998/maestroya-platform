import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: { dispute: { groupBy: vi.fn() } },
}));

describe("infrastructure/database/prisma/repositories/prisma-dispute-analytics-repository", () => {
  it("sums groupBy counts into the DisputeStatistics shape", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { dispute: { groupBy: ReturnType<typeof vi.fn> } }).dispute.groupBy.mockResolvedValue([
      { status: "OPEN", _count: { _all: 2 } },
      { status: "UNDER_REVIEW", _count: { _all: 1 } },
      { status: "WAITING_FOR_CUSTOMER", _count: { _all: 1 } },
      { status: "WAITING_FOR_PROFESSIONAL", _count: { _all: 1 } },
      { status: "RESOLVED", _count: { _all: 3 } },
      { status: "REJECTED", _count: { _all: 1 } },
      { status: "CLOSED", _count: { _all: 1 } },
    ]);

    const { PrismaDisputeAnalyticsRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-dispute-analytics-repository"
    );
    const stats = await new PrismaDisputeAnalyticsRepository().getStatistics();

    expect(stats).toEqual({
      total: 10,
      open: 2,
      underReview: 1,
      waitingOnParty: 2,
      resolved: 3,
      rejected: 1,
      closed: 1,
    });
  });

  it("returns all-zero statistics when there are no disputes", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { dispute: { groupBy: ReturnType<typeof vi.fn> } }).dispute.groupBy.mockResolvedValue([]);

    const { PrismaDisputeAnalyticsRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-dispute-analytics-repository"
    );
    const stats = await new PrismaDisputeAnalyticsRepository().getStatistics();

    expect(stats).toEqual({ total: 0, open: 0, underReview: 0, waitingOnParty: 0, resolved: 0, rejected: 0, closed: 0 });
  });
});
