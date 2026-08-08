import type { RefreshAnalyticsReadModelUseCase } from "@/application/use-cases/analytics-dashboard/refresh-analytics-read-model.use-case";
import type { AnalyticsDashboardSnapshot } from "@/domain/entities/analytics-dashboard";

export interface RebuildAnalyticsReadModelReport {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  snapshot: AnalyticsDashboardSnapshot;
}

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The operational backstop, exposed to an operator/admin API/cron caller —
 * this module's analogue of `RebuildSearchIndexUseCase`. Composed *on
 * top of* `RefreshAnalyticsReadModelUseCase` rather than duplicating its
 * body: both ultimately run `AnalyticsDashboardAssembler.assemble()` and
 * write the same store (see that class's own doc comment for why there is
 * only one recompute operation in this module). What makes this a
 * distinct, meaningful entry point rather than a redundant wrapper:
 *
 *  - It is **never coalesced away**. `RefreshAnalyticsReadModelUseCase`
 *    is normally invoked from a queue job keyed so a burst of events
 *    collapses onto one pending recompute (`analytics-refresh-jobs.ts`);
 *    a rebuild is enqueued with `operation: "rebuild"`, its own job kind,
 *    which is never de-duplicated against a pending incremental refresh —
 *    an operator explicitly asking "recompute now" must always run, even
 *    if a refresh is already in flight.
 *  - It reports a structured, timed result (`RebuildAnalyticsReadModelReport`)
 *    an API/CLI caller can surface, mirroring `RebuildSearchIndexReport`'s
 *    shape.
 *
 * **Safe by construction, trivially.** Unlike Module 47's rebuild (which
 * must avoid an empty-index window across many documents), this module's
 * read model is a single key: `store.set()` replaces it atomically from
 * the caller's point of view, and the computation runs to completion
 * *before* anything is written — there is no window where a reader sees a
 * partially-rebuilt dashboard, and running this twice in a row (or after
 * a failed run) simply recomputes and overwrites again, converging on the
 * same state.
 */
export class RebuildAnalyticsReadModelUseCase {
  constructor(
    private readonly refresh: RefreshAnalyticsReadModelUseCase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<RebuildAnalyticsReadModelReport> {
    const startedAt = this.now();

    const snapshot = await this.refresh.execute({ reason: "manual-rebuild", trigger: "on-demand" });

    const completedAt = this.now();
    return {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      snapshot: { ...snapshot, source: "manual-rebuild" },
    };
  }
}
