import type { DisputeStatistics, SupportTicketStatistics } from "@/domain/entities/analytics-dashboard";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * Two narrow, read-only, all-time count repositories, added for the two
 * KPI areas the module brief asked for that had no existing reporting
 * aggregate (Module 23's `analytics-repository.ts` covers users,
 * professionals, companies, service requests, quotes, bookings, jobs,
 * and reviews — not disputes or support tickets). Follows exactly the
 * precedent `analytics-repository.ts`'s own doc comment sets: a narrow,
 * purpose-built, query-only interface for a cross-cutting reporting
 * concern, kept separate from `DisputeRepository`/`SupportTicketRepository`
 * (both scoped to their own module's transactional CRUD needs) rather
 * than widening either.
 *
 * Query-only by construction — there is no mutating method here and
 * never will be, mirroring `PlatformAnalyticsRepository`'s own
 * "read-only by construction" contract.
 */
export interface DisputeAnalyticsRepository {
  getStatistics(): Promise<DisputeStatistics>;
}

export interface SupportTicketAnalyticsRepository {
  getStatistics(): Promise<SupportTicketStatistics>;
}
