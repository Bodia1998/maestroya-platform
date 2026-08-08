import type { RebuildAnalyticsReadModelUseCase } from "@/application/use-cases/analytics-dashboard/rebuild-analytics-read-model.use-case";
import type { RefreshAnalyticsReadModelUseCase } from "@/application/use-cases/analytics-dashboard/refresh-analytics-read-model.use-case";
import type { JobProcessor } from "@/infrastructure/jobs/worker";
import type { AnalyticsRefreshJobData } from "@/infrastructure/analytics/analytics-refresh-jobs";

export interface AnalyticsRefreshJobHandlers {
  refresh: RefreshAnalyticsReadModelUseCase;
  rebuild: RebuildAnalyticsReadModelUseCase;
}

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The `JobProcessor` the analytics-refresh `Worker` runs — routes a job
 * to the matching use case and does nothing else, the exact counterpart
 * of `createSearchIndexJobProcessor`. Errors are thrown, never handled:
 * the same "a throw means retry, then dead-letter" contract Module 45's
 * `Worker` is built around — catching here would silently convert a
 * failed recompute into a successful job and leave the dashboard stale
 * with no trace.
 */
export function createAnalyticsRefreshJobProcessor(
  handlers: AnalyticsRefreshJobHandlers,
): JobProcessor<AnalyticsRefreshJobData> {
  return async (job) => {
    const { operation, reason } = job.data;

    if (operation === "rebuild") {
      await handlers.rebuild.execute();
      return;
    }

    await handlers.refresh.execute({ reason, trigger: "event" });
  };
}
