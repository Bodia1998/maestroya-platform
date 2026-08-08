import type { AnalyticsDashboardSnapshot } from "@/domain/entities/analytics-dashboard";
import { buildEmptyDashboardSnapshot } from "@/domain/entities/analytics-dashboard";
import type { AnalyticsReadModelStore } from "@/application/ports/analytics-read-model-store";
import { nullAnalyticsObserver, type AnalyticsObserver } from "@/application/ports/analytics-observer";
import type { AnalyticsDashboardAssembler } from "@/application/services/analytics/analytics-dashboard-assembler";

export interface GetDashboardAnalyticsInput {
  /** Bypasses the cache and forces a live recompute — see
   *  `getDashboardAnalyticsQuerySchema`'s own doc comment. */
  forceRefresh?: boolean;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The CQRS **query side**: `execute()` asks `AnalyticsReadModelStore`
 * first and never touches Postgres itself — the analytics analogue of
 * `SearchReadModelUseCase`. A cache miss (or `forceRefresh`) falls
 * through to a live recompute via `AnalyticsDashboardAssembler`, which
 * *does* read Postgres (through Module 23's own use cases and this
 * module's two new repositories) — that fallback is what keeps the
 * dashboard correct even before the very first scheduled/event-triggered
 * refresh has ever run, at the cost of that one caller paying for the
 * live query. Every subsequent read within the TTL is served from the
 * store alone.
 *
 * ## Graceful degradation
 * Mirrors `SearchReadModelUseCase.execute()`'s contract: a failure never
 * propagates as a 500. If the store is unreachable *and* the live
 * recompute also fails, this returns `{ data: null, degraded: true }`
 * rather than throwing — an admin dashboard shows "analytics temporarily
 * unavailable" instead of crashing, because every number here is derived,
 * recoverable data, never the source of truth for a customer-facing
 * action.
 */
export class GetDashboardAnalyticsUseCase {
  constructor(
    private readonly store: AnalyticsReadModelStore,
    private readonly assembler: AnalyticsDashboardAssembler,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly observer: AnalyticsObserver = nullAnalyticsObserver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: GetDashboardAnalyticsInput = {}): Promise<AnalyticsDashboardSnapshot> {
    if (!input.forceRefresh) {
      const cached = await this.safeGet();
      if (cached) {
        this.observer.onCacheHit({ ageMs: this.now().getTime() - cached.computedAt.getTime() });
        return cached;
      }
      this.observer.onCacheMiss({ reason: "empty" });
    }

    try {
      const data = await this.assembler.assemble();
      const snapshot: AnalyticsDashboardSnapshot = {
        data,
        computedAt: this.now(),
        source: "live",
        degraded: false,
      };
      await this.safeSet(snapshot);
      return snapshot;
    } catch (error) {
      this.observer.onDegraded({ operation: "get-dashboard-analytics", error });
      return buildEmptyDashboardSnapshot("degraded", this.now());
    }
  }

  /** The store is a cache — a read failure degrades to "treat it as a
   *  miss", never propagates. */
  private async safeGet(): Promise<AnalyticsDashboardSnapshot | null> {
    try {
      return await this.store.get();
    } catch {
      return null;
    }
  }

  private async safeSet(snapshot: AnalyticsDashboardSnapshot): Promise<void> {
    try {
      await this.store.set(snapshot, this.ttlMs);
    } catch {
      // A failed cache write never fails the read — the caller already
      // has a correct, freshly-computed snapshot; only the *next* caller
      // pays for another live recompute.
    }
  }
}
