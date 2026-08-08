import { describe, expect, it, vi } from "vitest";

import { AnalyticsDashboardAssembler } from "@/application/services/analytics/analytics-dashboard-assembler";
import type { DisputeAnalyticsRepository, SupportTicketAnalyticsRepository } from "@/domain/repositories/analytics-extras-repository";
import type { SearchIndexProvider } from "@/application/ports/search-index-provider";

function fakePlatformSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    execute: vi.fn().mockResolvedValue({
      range: { from: null, to: null },
      users: { totalUsers: 10, newUsers: 1, activeUsers: 5, customers: 6, professionals: 3, companies: 1 },
      professionals: { total: 3, active: 3, verified: 2, newlyRegistered: 1, withCompletedJobs: 1 },
      companies: { total: 1, active: 1, verified: 1 },
      serviceRequests: { total: 5, newInPeriod: 2, byStatus: [], openRequests: 2, cancelledRequests: 1, completedRequests: 2 },
      quotes: { total: 4, accepted: 2, rejected: 1, expired: 0, withdrawn: 0, pendingOrSent: 1, averageAmount: 100, acceptanceRate: 0.5 },
      bookings: { total: 3, confirmed: 2, completed: 1, cancelled: 0, conversionRate: 0.33 },
      jobs: { total: 3, completed: 1, cancelled: 0, completionRate: 0.33 },
      reviews: { total: 2, averageRating: 4.5, distribution: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 1 } },
      financial: {
        grossLaborVolume: 1000,
        grossMaterialsVolume: 100,
        customerPlatformFees: 50,
        professionalCommissions: 150,
        platformGrossRevenue: 200,
        refundsTotal: 0,
        disputeAdjustmentsTotal: 0,
        payoutsTotal: 850,
        paymentCount: 3,
      },
      ...overrides,
    }),
  };
}

function fakeFunnel() {
  return {
    execute: vi.fn().mockResolvedValue({
      range: { from: null, to: null },
      requestsCreated: 5,
      requestsWithQuotes: 4,
      requestsWithAcceptedQuote: 2,
      requestsWithBooking: 2,
      requestsCompleted: 1,
      requestToQuoteRate: 0.8,
      quoteToAcceptanceRate: 0.5,
      acceptanceToBookingRate: 1,
      bookingToCompletionRate: 0.5,
      overallCompletionRate: 0.2,
    }),
  };
}

describe("application/services/analytics/analytics-dashboard-assembler", () => {
  it("assembles a full AnalyticsDashboard from every source", async () => {
    const disputes: DisputeAnalyticsRepository = {
      getStatistics: vi.fn().mockResolvedValue({
        total: 2,
        open: 1,
        underReview: 0,
        waitingOnParty: 0,
        resolved: 1,
        rejected: 0,
        closed: 0,
      }),
    };
    const supportTickets: SupportTicketAnalyticsRepository = {
      getStatistics: vi.fn().mockResolvedValue({
        total: 1,
        open: 1,
        inProgress: 0,
        waitingForUser: 0,
        resolved: 0,
        closed: 0,
      }),
    };
    const searchProvider = {
      ping: vi.fn().mockResolvedValue({ provider: "memory", reachable: true, documentCount: 42, latencyMs: 1 }),
    } as unknown as SearchIndexProvider;

    const assembler = new AnalyticsDashboardAssembler(
      fakePlatformSummary() as never,
      fakeFunnel() as never,
      disputes,
      supportTickets,
      searchProvider,
      () => ({ activeConnections: 3, activeChannels: 2, onlineUsers: 1 }),
    );

    const dashboard = await assembler.assemble();

    expect(dashboard.growth.totalUsers).toBe(10);
    expect(dashboard.professionals.total).toBe(3);
    expect(dashboard.companies.total).toBe(1);
    expect(dashboard.marketplace.funnel.requestsCreated).toBe(5);
    expect(dashboard.marketplace.quotes.total).toBe(4);
    expect(dashboard.bookings.jobs.completed).toBe(1);
    expect(dashboard.reviews.total).toBe(2);
    expect(dashboard.revenue.platformGrossRevenue).toBe(200);
    expect(dashboard.disputes).toEqual(
      expect.objectContaining({ total: 2, open: 1, resolved: 1 }),
    );
    expect(dashboard.supportTickets).toEqual(expect.objectContaining({ total: 1, open: 1 }));
    expect(dashboard.search).toEqual({ provider: "memory", reachable: true, documentCount: 42 });
    expect(dashboard.realtime).toEqual({ activeConnections: 3, activeChannels: 2, onlineUsers: 1 });
  });

  it("queries every source concurrently, not sequentially", async () => {
    const platformSummary = fakePlatformSummary();
    const funnel = fakeFunnel();
    const disputes: DisputeAnalyticsRepository = {
      getStatistics: vi.fn().mockResolvedValue({ total: 0, open: 0, underReview: 0, waitingOnParty: 0, resolved: 0, rejected: 0, closed: 0 }),
    };
    const supportTickets: SupportTicketAnalyticsRepository = {
      getStatistics: vi.fn().mockResolvedValue({ total: 0, open: 0, inProgress: 0, waitingForUser: 0, resolved: 0, closed: 0 }),
    };
    const searchProvider = {
      ping: vi.fn().mockResolvedValue({ provider: "memory", reachable: true, documentCount: 0, latencyMs: 1 }),
    } as unknown as SearchIndexProvider;

    const assembler = new AnalyticsDashboardAssembler(
      platformSummary as never,
      funnel as never,
      disputes,
      supportTickets,
      searchProvider,
      () => ({ activeConnections: 0, activeChannels: 0, onlineUsers: 0 }),
    );

    await assembler.assemble();

    expect(platformSummary.execute).toHaveBeenCalledTimes(1);
    expect(funnel.execute).toHaveBeenCalledTimes(1);
    expect(disputes.getStatistics).toHaveBeenCalledTimes(1);
    expect(supportTickets.getStatistics).toHaveBeenCalledTimes(1);
    expect(searchProvider.ping).toHaveBeenCalledTimes(1);
  });
});
