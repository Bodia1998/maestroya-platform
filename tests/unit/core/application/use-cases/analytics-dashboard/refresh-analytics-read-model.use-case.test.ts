import { describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_DASHBOARD_REALTIME_CHANNEL,
  ANALYTICS_DASHBOARD_UPDATED_EVENT,
  RefreshAnalyticsReadModelUseCase,
} from "@/application/use-cases/analytics-dashboard/refresh-analytics-read-model.use-case";
import type { AnalyticsReadModelStore } from "@/application/ports/analytics-read-model-store";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("application/use-cases/analytics-dashboard/refresh-analytics-read-model.use-case", () => {
  it("recomputes, stores the snapshot, and publishes a realtime notification", async () => {
    const dashboard = { fake: true } as never;
    const assembler = { assemble: vi.fn().mockResolvedValue(dashboard) };
    const store: AnalyticsReadModelStore = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined), invalidate: vi.fn() };
    const publishToChannel = { execute: vi.fn().mockReturnValue({ deliveredTo: 1 }) };

    const useCase = new RefreshAnalyticsReadModelUseCase(
      assembler as never,
      store,
      publishToChannel as never,
      60_000,
      undefined,
      () => NOW,
    );

    const snapshot = await useCase.execute({ reason: "review.created", trigger: "event" });

    expect(snapshot).toEqual({ data: dashboard, computedAt: NOW, source: "event", degraded: false });
    expect(store.set).toHaveBeenCalledWith(snapshot, 60_000);
    expect(publishToChannel.execute).toHaveBeenCalledWith({
      channel: ANALYTICS_DASHBOARD_REALTIME_CHANNEL,
      type: ANALYTICS_DASHBOARD_UPDATED_EVENT,
      payload: { computedAt: NOW.toISOString(), reason: "review.created" },
    });
  });

  it("maps trigger to the right snapshot source", async () => {
    const assembler = { assemble: vi.fn().mockResolvedValue({}) };
    const store: AnalyticsReadModelStore = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined), invalidate: vi.fn() };
    const publishToChannel = { execute: vi.fn() };
    const useCase = new RefreshAnalyticsReadModelUseCase(assembler as never, store, publishToChannel as never, 60_000, undefined, () => NOW);

    expect((await useCase.execute({ reason: "scheduled", trigger: "scheduled" })).source).toBe("scheduled");
    expect((await useCase.execute({ reason: "manual-rebuild", trigger: "on-demand" })).source).toBe("live");
  });

  it("a failed realtime publish is swallowed — the refresh has already succeeded", async () => {
    const dashboard = { fake: true } as never;
    const assembler = { assemble: vi.fn().mockResolvedValue(dashboard) };
    const store: AnalyticsReadModelStore = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined), invalidate: vi.fn() };
    const publishToChannel = {
      execute: vi.fn(() => {
        throw new Error("realtime hub down");
      }),
    };

    const useCase = new RefreshAnalyticsReadModelUseCase(assembler as never, store, publishToChannel as never, 60_000, undefined, () => NOW);

    await expect(useCase.execute({ reason: "review.created" })).resolves.toEqual(
      expect.objectContaining({ data: dashboard, degraded: false }),
    );
  });

  it("throws (never swallows) a failed recompute, so the worker can retry", async () => {
    const failure = new Error("db unreachable");
    const assembler = { assemble: vi.fn().mockRejectedValue(failure) };
    const store: AnalyticsReadModelStore = { get: vi.fn(), set: vi.fn(), invalidate: vi.fn() };
    const onRefreshFailed = vi.fn();

    const useCase = new RefreshAnalyticsReadModelUseCase(
      assembler as never,
      store,
      { execute: vi.fn() } as never,
      60_000,
      { onCacheHit: vi.fn(), onCacheMiss: vi.fn(), onRefreshCompleted: vi.fn(), onRefreshFailed, onDegraded: vi.fn() },
      () => NOW,
    );

    await expect(useCase.execute({ reason: "review.created" })).rejects.toThrow(failure);
    expect(store.set).not.toHaveBeenCalled();
    expect(onRefreshFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: "review.created", error: failure }));
  });
});
