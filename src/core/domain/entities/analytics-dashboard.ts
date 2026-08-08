/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The read model this module maintains: a single, cohesive, cached
 * projection of the platform's operational and business KPIs — the
 * analytics analogue of Module 47's `SearchDocument`. Unlike a search
 * index (many small, independently-refreshable documents keyed by entity
 * id), a dashboard KPI set is naturally *one* aggregate artifact — every
 * number on it is computed by the same handful of grouped-count/sum
 * queries over the whole table, not by looking up one row. That is why
 * this file defines one composed `AnalyticsDashboard`, not fifteen
 * separate top-level entities: Module 47's "file per concept" style is
 * mirrored at the *field-group* level (each concept below is its own
 * named, documented interface) without pretending each group is an
 * independently addressable read-model row the way a `SearchDocument` is.
 *
 * Every field here is either read verbatim from another module's own
 * authoritative aggregate (Module 23's `PlatformAnalyticsSummaryDTO`,
 * Module 22's revenue summary via Module 23, and so on) or computed by a
 * narrow, read-only, purpose-built repository this module adds for a KPI
 * area with no existing aggregate query (disputes, support tickets). No
 * figure here is a second, independently-maintained source of truth for
 * a number another module already owns — see docs/
 * MODULE_50_ANALYTICS_DASHBOARD.md, "Relationship to Module 23," for the
 * full reasoning.
 */

// ---------------------------------------------------------------------------
// Field groups (the "one file per concept" list from the module brief,
// mirrored as named interfaces rather than separate top-level files —
// see this file's own doc comment for why).
// ---------------------------------------------------------------------------

export interface AnalyticsDashboardRange {
  from: Date | null;
  to: Date | null;
}

/** Users + professionals + companies — the platform's growth surface. */
export interface GrowthStatistics {
  totalUsers: number;
  newUsers: number;
  activeUsers: number;
  customers: number;
  professionals: number;
  companies: number;
}

export interface ProfessionalStatistics {
  total: number;
  active: number;
  verified: number;
  newlyRegistered: number;
  withCompletedJobs: number;
}

export interface CompanyStatistics {
  total: number;
  active: number;
  verified: number;
}

/** Quotes + service requests + the acquisition funnel — the marketplace's core activity. */
export interface MarketplaceStatistics {
  serviceRequests: {
    total: number;
    newInPeriod: number;
    openRequests: number;
    cancelledRequests: number;
    completedRequests: number;
  };
  quotes: {
    total: number;
    accepted: number;
    rejected: number;
    expired: number;
    withdrawn: number;
    pendingOrSent: number;
    averageAmount: number | null;
    acceptanceRate: number | null;
  };
  funnel: {
    requestsCreated: number;
    requestsWithQuotes: number;
    requestsWithAcceptedQuote: number;
    requestsWithBooking: number;
    requestsCompleted: number;
    requestToQuoteRate: number | null;
    quoteToAcceptanceRate: number | null;
    acceptanceToBookingRate: number | null;
    bookingToCompletionRate: number | null;
    overallCompletionRate: number | null;
  };
}

/** Appointments ("bookings" — no `Booking` entity exists, see the module
 *  doc's naming note) + Jobs — the execution/fulfillment surface. */
export interface BookingStatistics {
  bookings: {
    total: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    conversionRate: number | null;
  };
  jobs: {
    total: number;
    completed: number;
    cancelled: number;
    completionRate: number | null;
  };
}

export interface ReviewStatistics {
  total: number;
  averageRating: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

/** Exactly Module 22's own revenue aggregate, re-exposed — this module
 *  never recomputes a commission or platform-fee figure. */
export interface RevenueStatistics {
  grossLaborVolume: number;
  grossMaterialsVolume: number;
  customerPlatformFees: number;
  professionalCommissions: number;
  platformGrossRevenue: number;
  refundsTotal: number;
  disputeAdjustmentsTotal: number;
  payoutsTotal: number;
  paymentCount: number;
}

/** New in this module — no existing aggregate query covered disputes.
 *  Backed by `DisputeAnalyticsRepository` (a narrow, read-only,
 *  Module-23-style reporting repository), never the transactional
 *  `DisputeRepository`. */
export interface DisputeStatistics {
  total: number;
  open: number;
  underReview: number;
  waitingOnParty: number;
  resolved: number;
  rejected: number;
  closed: number;
}

/** New in this module — same reasoning as `DisputeStatistics`, backed by
 *  `SupportTicketAnalyticsRepository`. */
export interface SupportTicketStatistics {
  total: number;
  open: number;
  inProgress: number;
  waitingForUser: number;
  resolved: number;
  closed: number;
}

/**
 * Sourced from Module 47's own `SearchIndexProvider.ping()` — this module
 * adds no new search query or table read of its own. Deliberately does
 * not duplicate `checks.searchEngine`'s full shape (queue counts, sync
 * state); it surfaces only the two numbers a KPI dashboard cares about,
 * the same "narrower than the health report" reasoning `RevenueStatistics`
 * already follows for Module 22's figures.
 */
export interface SearchStatistics {
  provider: string;
  reachable: boolean;
  documentCount: number | null;
}

/** Sourced from Module 48's own `getRealtimeHealth()` — same reasoning as
 *  `SearchStatistics`: no new connection/channel tracking is introduced. */
export interface RealtimeStatistics {
  activeConnections: number;
  activeChannels: number;
  onlineUsers: number;
}

/**
 * The composed read model — one snapshot, every KPI area the module
 * brief asked for, each field group documented above. `range` is always
 * the unranged (all-time) window: see docs/MODULE_50_ANALYTICS_DASHBOARD.md,
 * "Why one range," for why the cached dashboard does not vary by caller-
 * supplied date range the way Module 23's own live queries do.
 */
export interface AnalyticsDashboard {
  range: AnalyticsDashboardRange;
  growth: GrowthStatistics;
  professionals: ProfessionalStatistics;
  companies: CompanyStatistics;
  marketplace: MarketplaceStatistics;
  bookings: BookingStatistics;
  reviews: ReviewStatistics;
  revenue: RevenueStatistics;
  disputes: DisputeStatistics;
  supportTickets: SupportTicketStatistics;
  search: SearchStatistics;
  realtime: RealtimeStatistics;
}

export type AnalyticsSnapshotSource = "cache" | "live" | "scheduled" | "event" | "manual-rebuild" | "degraded";

/**
 * The stored/returned envelope — the analytics analogue of a
 * `SearchIndexHit`: never the bare entity, always paired with the
 * metadata a caller needs to reason about freshness. `data: null` only
 * ever happens when both the cache and a live recompute failed (see
 * `GetDashboardAnalyticsUseCase`) — the CQRS read side's own graceful-
 * degradation contract, mirroring `SearchReadModelUseCase`'s
 * `{ items: [], degraded: true }`.
 */
export interface AnalyticsDashboardSnapshot {
  data: AnalyticsDashboard | null;
  computedAt: Date;
  source: AnalyticsSnapshotSource;
  degraded: boolean;
}

export function buildEmptyDashboardSnapshot(
  source: AnalyticsSnapshotSource,
  now: Date = new Date(),
): AnalyticsDashboardSnapshot {
  return { data: null, computedAt: now, source, degraded: true };
}
