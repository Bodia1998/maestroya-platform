import { describe, expect, it, vi } from "vitest";

import { GetDashboardAnalyticsUseCase } from "@/application/use-cases/analytics-dashboard/get-dashboard-analytics.use-case";
import type { AnalyticsReadModelStore } from "@/application/ports/analytics-read-model-store";
import type { AnalyticsDashboard, AnalyticsDashboardSnapshot } from "@/domain/entities/analytics-dashboard";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function fakeDashboard(): AnalyticsDashboard {
  return {
    range: { from: null, to: null },
    growth: { totalUsers: 1, newUsers: 0, activeUsers: 1, customers: 1, professionals: 0, companies: 0 },
    professionals: { total: 0, active: 0, verified: 0, newlyRegistered: 0, withCompletedJobs: 0 },
    companies: { total: 0, active: 0, verified: 0 },
    marketplace: {
      serviceRequests: { total: 0, newInPeriod: 0, openRequests: 0, cancelledRequests: 0, completedRequests: 0 },
      quotes: { total: 0, accepted: 0, rejected: 0, expired: 0, withdrawn: 0, pendingOrSent: 0, averageAmount: null, acceptanceRate: null },
      funnel: {
        requestsCreated: 0,
        requestsWithQuotes: 0,
        requestsWithAcceptedQuote: 0,
        requestsWithBooking: 0,
        requestsCompleted: 0,
        requestToQuoteRate: null,
        quoteToAcceptanceRate: null,
        acceptanceToBookingRate: null,
        bookingToCompletionRate: null,
        overallCompletionRate: null,
      },
    },
    bookings: {
      bookings: { total: 0, confirmed: 0, completed: 0, cancelled: 0, conversionRate: null },
      jobs: { total: 0, completed: 0, cancelled: 0, completionRate: null },
    },
    reviews: { total: 0, averageRating: null, distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } },
    revenue: {
      grossLaborVolume: 0,
      grossMaterialsVolume: 0,
      customerPlatformFees: 0,
      professionalCommissions: 0,
      platformGrossRevenue: 0,
      refundsTotal: 0,
      disputeAdjustmentsTotal: 0,
      payoutsTotal: 0,
      paymentCount: 0,
    },
    disputes: { total: 0, open: 0, underReview: 0, waitingOnParty: 0, resolved: 0, rejected: 0, closed: 0 },
    supportTickets: { total: 0, open: 0, inProgress: 0, waitingForUser: 0, resolved: 0, closed: 0 },
    search: { provider: "memory", reachable: true, documentCount: 0 },
    realtime: { activeConnections: 0, activeChannels: 0, onlineUsers: 0 },
  };
}

describe("application/use-cases/analytics-dashboard/get-dashboard-analytics.use-case", () => {
  it("returns the cached snapshot on a hit, without recomputing", async () => {
    const cached: AnalyticsDashboardSnapshot = { data: fakeDashboard(), computedAt: NOW, source: "cache", degraded: false };
    const store: AnalyticsReadModelStore = {
      get: vi.fn().mockResolvedValue(cached),
      set: vi.fn(),
      invalidate: vi.fn(),
    };
    const assembler = { assemble: vi.fn() };

    const useCase = new GetDashboardAnalyticsUseCase(store, assembler as never, 60_000, undefined, () => NOW);
    const result = await useCase.execute();

    expect(result).toBe(cached);
    expect(assembler.assemble).not.toHaveBeenCalled();
  });

  it("recomputes live and stores it on a cache miss", async () => {
    const dashboard = fakeDashboard();
    const store: AnalyticsReadModelStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      invalidate: vi.fn(),
    };
    const assembler = { assemble: vi.fn().mockResolvedValue(dashboard) };

    const useCase = new GetDashboardAnalyticsUseCase(store, assembler as never, 60_000, undefined, () => NOW);
    const result = await useCase.execute();

    expect(result).toEqual({ data: dashboard, computedAt: NOW, source: "live", degraded: false });
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({ data: dashboard }), 60_000);
  });

  it("forceRefresh bypasses the cache even on a hit", async () => {
    const cached: AnalyticsDashboardSnapshot = { data: fakeDashboard(), computedAt: NOW, source: "cache", degraded: false };
    const dashboard = fakeDashboard();
    const store: AnalyticsReadModelStore = {
      get: vi.fn().mockResolvedValue(cached),
      set: vi.fn().mockResolvedValue(undefined),
      invalidate: vi.fn(),
    };
    const assembler = { assemble: vi.fn().mockResolvedValue(dashboard) };

    const useCase = new GetDashboardAnalyticsUseCase(store, assembler as never, 60_000, undefined, () => NOW);
    const result = await useCase.execute({ forceRefresh: true });

    expect(store.get).not.toHaveBeenCalled();
    expect(assembler.assemble).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("live");
  });

  it("degrades to a null-data snapshot when both the store and the live recompute fail", async () => {
    const store: AnalyticsReadModelStore = {
      get: vi.fn().mockRejectedValue(new Error("store down")),
      set: vi.fn(),
      invalidate: vi.fn(),
    };
    const assembler = { assemble: vi.fn().mockRejectedValue(new Error("db down")) };
    const onDegraded = vi.fn();

    const useCase = new GetDashboardAnalyticsUseCase(
      store,
      assembler as never,
      60_000,
      { onCacheHit: vi.fn(), onCacheMiss: vi.fn(), onRefreshCompleted: vi.fn(), onRefreshFailed: vi.fn(), onDegraded },
      () => NOW,
    );
    const result = await useCase.execute();

    expect(result).toEqual({ data: null, computedAt: NOW, source: "degraded", degraded: true });
    expect(onDegraded).toHaveBeenCalledWith(expect.objectContaining({ operation: "get-dashboard-analytics" }));
  });

  it("a failed cache write never fails the read — the freshly computed snapshot is still returned", async () => {
    const dashboard = fakeDashboard();
    const store: AnalyticsReadModelStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error("cache write failed")),
      invalidate: vi.fn(),
    };
    const assembler = { assemble: vi.fn().mockResolvedValue(dashboard) };

    const useCase = new GetDashboardAnalyticsUseCase(store, assembler as never, 60_000, undefined, () => NOW);
    const result = await useCase.execute();

    expect(result.data).toBe(dashboard);
    expect(result.degraded).toBe(false);
  });
});
