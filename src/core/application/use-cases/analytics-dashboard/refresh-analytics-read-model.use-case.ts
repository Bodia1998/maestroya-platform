import type { AnalyticsReadModelStore } from "@/application/ports/analytics-read-model-store";
import { nullAnalyticsObserver, type AnalyticsObserver } from "@/application/ports/analytics-observer";
import type { AnalyticsDashboardAssembler } from "@/application/services/analytics/analytics-dashboard-assembler";
import type { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";
import type { AnalyticsDashboardSnapshot, AnalyticsSnapshotSource } from "@/domain/entities/analytics-dashboard";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
/** Module 48's singleton, platform-staff-only channel — see
 *  `RealtimeChannel`'s own doc comment. No new channel type is added. */
export const ANALYTICS_DASHBOARD_REALTIME_CHANNEL = "admin";
export const ANALYTICS_DASHBOARD_UPDATED_EVENT = "analytics.dashboard-updated";

export interface RefreshAnalyticsReadModelInput {
  /** Short label for logs/observability — the event name, `"scheduled"`,
   *  or a caller-supplied reason. Never branched on: see this module's
   *  class doc for why refresh and rebuild run the identical query. */
  reason: string;
  trigger?: "event" | "scheduled" | "on-demand";
}

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The CQRS **write side**, event-driven/scheduled recompute path —
 * this module's analogue of `IndexSearchDocumentUseCase`. Always runs in
 * a background worker (`AnalyticsRefreshQueueAdapter` + a Module 45
 * `Worker`), never inline in a request handler — see
 * `EnqueueAnalyticsRefreshSubscriber`'s own doc comment for why that is
 * structural, not just documented.
 *
 * ## Why this is the *only* recompute operation
 * Unlike Module 47's search index — many independent documents, where
 * "index one entity" and "rebuild everything" are genuinely different
 * operations — the analytics dashboard is a single cached aggregate.
 * There is no per-entity slice to refresh incrementally: every field on
 * `AnalyticsDashboard` already comes from a grouped query over the whole
 * table. `RefreshAnalyticsReadModelUseCase` and
 * `RebuildAnalyticsReadModelUseCase` (`rebuild-analytics-read-model.use-
 * case.ts`) therefore call the *same* `AnalyticsDashboardAssembler.assemble()`
 * and differ only in what they represent operationally: this class is the
 * automatic, debounced/coalesced path a domain event or the periodic
 * schedule drives; the other is the explicit, always-runs, operator/API-
 * triggered path (never coalesced away by a pending duplicate job) — kept
 * as two classes for parity with Module 47's shape (distinct job types,
 * distinct log events, distinct API affordances), not because the
 * computation differs. See docs/MODULE_50_ANALYTICS_DASHBOARD.md.
 *
 * Errors are thrown, never swallowed — the same contract
 * `IndexSearchDocumentUseCase` follows, so Module 45's `Worker` can retry
 * with backoff and eventually dead-letter a persistently failing refresh
 * rather than silently leaving the read model stale with no trace.
 */
export class RefreshAnalyticsReadModelUseCase {
  constructor(
    private readonly assembler: AnalyticsDashboardAssembler,
    private readonly store: AnalyticsReadModelStore,
    private readonly publishToChannel: PublishToChannelUseCase,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly observer: AnalyticsObserver = nullAnalyticsObserver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: RefreshAnalyticsReadModelInput): Promise<AnalyticsDashboardSnapshot> {
    const startedAt = this.now();
    const trigger = input.trigger ?? "event";

    try {
      const data = await this.assembler.assemble();
      const snapshot: AnalyticsDashboardSnapshot = {
        data,
        computedAt: this.now(),
        source: mapSource(trigger),
        degraded: false,
      };

      await this.store.set(snapshot, this.ttlMs);

      this.observer.onRefreshCompleted({
        trigger,
        reason: input.reason,
        durationMs: this.now().getTime() - startedAt.getTime(),
      });

      // Best-effort — a realtime notification failing must never fail a
      // refresh that already succeeded and is already durably cached; the
      // next poll/read still sees the fresh snapshot regardless.
      try {
        this.publishToChannel.execute({
          channel: ANALYTICS_DASHBOARD_REALTIME_CHANNEL,
          type: ANALYTICS_DASHBOARD_UPDATED_EVENT,
          payload: { computedAt: snapshot.computedAt.toISOString(), reason: input.reason },
        });
      } catch {
        // Swallowed deliberately — see comment above.
      }

      return snapshot;
    } catch (error) {
      this.observer.onRefreshFailed({ trigger, reason: input.reason, error });
      throw error;
    }
  }
}

function mapSource(trigger: "event" | "scheduled" | "on-demand"): AnalyticsSnapshotSource {
  if (trigger === "scheduled") return "scheduled";
  if (trigger === "on-demand") return "live";
  return "event";
}
