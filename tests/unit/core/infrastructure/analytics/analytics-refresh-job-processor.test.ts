import { describe, expect, it, vi } from "vitest";

import { createAnalyticsRefreshJobProcessor } from "@/infrastructure/analytics/analytics-refresh-job-processor";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";
import type { AnalyticsRefreshJobData } from "@/infrastructure/analytics/analytics-refresh-jobs";

function fakeJob(data: AnalyticsRefreshJobData): ActiveJob<AnalyticsRefreshJobData> {
  return { id: "job-1", queue: "analytics-refresh", name: "analytics.refresh", data } as unknown as ActiveJob<AnalyticsRefreshJobData>;
}

describe("infrastructure/analytics/analytics-refresh-job-processor", () => {
  it("routes a 'refresh' job to RefreshAnalyticsReadModelUseCase with the job's reason", async () => {
    const refresh = { execute: vi.fn().mockResolvedValue(undefined) };
    const rebuild = { execute: vi.fn() };
    const processor = createAnalyticsRefreshJobProcessor({ refresh: refresh as never, rebuild: rebuild as never });

    await processor(fakeJob({ operation: "refresh", reason: "review.created" }));

    expect(refresh.execute).toHaveBeenCalledWith({ reason: "review.created", trigger: "event" });
    expect(rebuild.execute).not.toHaveBeenCalled();
  });

  it("routes a 'rebuild' job to RebuildAnalyticsReadModelUseCase", async () => {
    const refresh = { execute: vi.fn() };
    const rebuild = { execute: vi.fn().mockResolvedValue(undefined) };
    const processor = createAnalyticsRefreshJobProcessor({ refresh: refresh as never, rebuild: rebuild as never });

    await processor(fakeJob({ operation: "rebuild", reason: "manual-rebuild" }));

    expect(rebuild.execute).toHaveBeenCalledTimes(1);
    expect(refresh.execute).not.toHaveBeenCalled();
  });

  it("lets a use case's error propagate — never swallowed", async () => {
    const failure = new Error("recompute failed");
    const refresh = { execute: vi.fn().mockRejectedValue(failure) };
    const rebuild = { execute: vi.fn() };
    const processor = createAnalyticsRefreshJobProcessor({ refresh: refresh as never, rebuild: rebuild as never });

    await expect(processor(fakeJob({ operation: "refresh", reason: "review.created" }))).rejects.toThrow(failure);
  });
});
