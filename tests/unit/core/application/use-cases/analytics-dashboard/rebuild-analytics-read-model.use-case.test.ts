import { describe, expect, it, vi } from "vitest";

import { RebuildAnalyticsReadModelUseCase } from "@/application/use-cases/analytics-dashboard/rebuild-analytics-read-model.use-case";

const STARTED = new Date("2026-01-01T00:00:00.000Z");
const COMPLETED = new Date("2026-01-01T00:00:00.500Z");

describe("application/use-cases/analytics-dashboard/rebuild-analytics-read-model.use-case", () => {
  it("delegates to RefreshAnalyticsReadModelUseCase with a manual-rebuild reason/trigger and reports timing", async () => {
    const snapshot = { data: { fake: true }, computedAt: COMPLETED, source: "live" as const, degraded: false };
    const refresh = { execute: vi.fn().mockResolvedValue(snapshot) };
    let calls = 0;
    const now = () => (calls++ === 0 ? STARTED : COMPLETED);

    const useCase = new RebuildAnalyticsReadModelUseCase(refresh as never, now);
    const report = await useCase.execute();

    expect(refresh.execute).toHaveBeenCalledWith({ reason: "manual-rebuild", trigger: "on-demand" });
    expect(report.startedAt).toBe(STARTED.toISOString());
    expect(report.completedAt).toBe(COMPLETED.toISOString());
    expect(report.durationMs).toBe(COMPLETED.getTime() - STARTED.getTime());
    expect(report.snapshot).toEqual({ ...snapshot, source: "manual-rebuild" });
  });

  it("propagates a failed refresh rather than swallowing it", async () => {
    const failure = new Error("recompute failed");
    const refresh = { execute: vi.fn().mockRejectedValue(failure) };
    const useCase = new RebuildAnalyticsReadModelUseCase(refresh as never);

    await expect(useCase.execute()).rejects.toThrow(failure);
  });
});
