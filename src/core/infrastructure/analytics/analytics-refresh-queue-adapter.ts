import type { AnalyticsRefreshQueue, AnalyticsRefreshRequest } from "@/application/ports/analytics-refresh-queue";
import type { JobOptions } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";
import { analyticsRefreshJobId, type AnalyticsRefreshJobData } from "@/infrastructure/analytics/analytics-refresh-jobs";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * Implements the application-layer `AnalyticsRefreshQueue` port over a
 * Module 45 `Queue` — the analytics analogue of `SearchIndexQueueAdapter`.
 * Always enqueues `operation: "refresh"`; the rebuild path
 * (`operation: "rebuild"`) is enqueued separately by
 * `getRebuildAnalyticsReadModelUseCase()`'s own caller
 * (`infrastructure/analytics/compose.ts`), not through this port — see
 * `analytics-refresh-jobs.ts` for why the two must never share a job id.
 */
export class AnalyticsRefreshQueueAdapter implements AnalyticsRefreshQueue {
  constructor(
    private readonly queue: Queue<AnalyticsRefreshJobData>,
    private readonly jobOptions: JobOptions,
  ) {}

  async enqueue(request: AnalyticsRefreshRequest): Promise<void> {
    const data: AnalyticsRefreshJobData = { operation: "refresh", reason: request.reason, eventId: request.eventId };
    await this.queue.add("analytics.refresh", data, { ...this.jobOptions, jobId: analyticsRefreshJobId(data) });
  }
}
