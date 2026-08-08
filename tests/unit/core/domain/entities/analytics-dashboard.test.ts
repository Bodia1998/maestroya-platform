import { describe, expect, it } from "vitest";

import { buildEmptyDashboardSnapshot } from "@/domain/entities/analytics-dashboard";

describe("domain/entities/analytics-dashboard", () => {
  it("buildEmptyDashboardSnapshot() returns a degraded, null-data snapshot", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const snapshot = buildEmptyDashboardSnapshot("degraded", now);

    expect(snapshot).toEqual({ data: null, computedAt: now, source: "degraded", degraded: true });
  });

  it("buildEmptyDashboardSnapshot() defaults to the current time when none is supplied", () => {
    const before = Date.now();
    const snapshot = buildEmptyDashboardSnapshot("degraded");
    const after = Date.now();

    expect(snapshot.computedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(snapshot.computedAt.getTime()).toBeLessThanOrEqual(after);
  });
});
