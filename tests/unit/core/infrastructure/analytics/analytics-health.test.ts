import { describe, expect, it, vi } from "vitest";

import { collectAnalyticsHealth, DISABLED_ANALYTICS_HEALTH } from "@/infrastructure/analytics/analytics-health";

describe("infrastructure/analytics/analytics-health", () => {
  it("DISABLED_ANALYTICS_HEALTH is the disabled, no-snapshot report", () => {
    expect(DISABLED_ANALYTICS_HEALTH).toEqual({
      status: "disabled",
      refreshEnabled: false,
      hasSnapshot: false,
      lastComputedAt: null,
      lastSource: null,
      queue: {},
    });
  });

  it("reports 'ok' with no snapshot yet and no queues", async () => {
    const report = await collectAnalyticsHealth({ refreshEnabled: true, snapshot: null, queues: [] });
    expect(report).toEqual({
      status: "ok",
      refreshEnabled: true,
      hasSnapshot: false,
      lastComputedAt: null,
      lastSource: null,
      queue: {},
    });
  });

  it("reports the snapshot's timestamp/source and queue counts when present", async () => {
    const computedAt = new Date("2026-01-01T00:00:00.000Z");
    const report = await collectAnalyticsHealth({
      refreshEnabled: true,
      snapshot: { computedAt, source: "scheduled", degraded: false },
      queues: [
        { name: "analytics-refresh", getCounts: vi.fn().mockResolvedValue({ waiting: 0, delayed: 0, active: 0, completed: 1, failed: 0 }) },
      ],
    });

    expect(report.status).toBe("ok");
    expect(report.hasSnapshot).toBe(true);
    expect(report.lastComputedAt).toBe(computedAt.toISOString());
    expect(report.lastSource).toBe("scheduled");
    expect(report.queue["analytics-refresh"]).toEqual({ waiting: 0, delayed: 0, active: 0, completed: 1, failed: 0 });
  });

  it("is 'degraded' when the stored snapshot itself is flagged degraded", async () => {
    const report = await collectAnalyticsHealth({
      refreshEnabled: true,
      snapshot: { computedAt: new Date(), source: "degraded", degraded: true },
      queues: [],
    });
    expect(report.status).toBe("degraded");
  });

  it("never throws — a failing queue count degrades the report instead", async () => {
    const report = await collectAnalyticsHealth({
      refreshEnabled: true,
      snapshot: null,
      queues: [{ name: "analytics-refresh", getCounts: vi.fn().mockRejectedValue(new Error("store down")) }],
    });
    expect(report.status).toBe("degraded");
  });
});
