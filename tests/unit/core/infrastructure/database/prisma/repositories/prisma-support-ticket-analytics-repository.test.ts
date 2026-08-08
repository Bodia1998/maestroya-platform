import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: { supportTicket: { groupBy: vi.fn() } },
}));

describe("infrastructure/database/prisma/repositories/prisma-support-ticket-analytics-repository", () => {
  it("sums groupBy counts into the SupportTicketStatistics shape", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { supportTicket: { groupBy: ReturnType<typeof vi.fn> } }).supportTicket.groupBy.mockResolvedValue([
      { status: "OPEN", _count: { _all: 3 } },
      { status: "IN_PROGRESS", _count: { _all: 2 } },
      { status: "WAITING_FOR_USER", _count: { _all: 1 } },
      { status: "RESOLVED", _count: { _all: 4 } },
      { status: "CLOSED", _count: { _all: 5 } },
    ]);

    const { PrismaSupportTicketAnalyticsRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-support-ticket-analytics-repository"
    );
    const stats = await new PrismaSupportTicketAnalyticsRepository().getStatistics();

    expect(stats).toEqual({ total: 15, open: 3, inProgress: 2, waitingForUser: 1, resolved: 4, closed: 5 });
  });
});
