import { describe, expect, it } from "vitest";

import { toDependencyStatus } from "@/application/services/health/dependency-status";
import type { CircuitBreakerSnapshot } from "@/domain/entities/circuit-breaker";

function snapshot(overrides: Partial<CircuitBreakerSnapshot> = {}): CircuitBreakerSnapshot {
  return {
    name: "dep",
    state: "CLOSED",
    config: { failureThreshold: 5, successThreshold: 2, timeoutMs: 5000, resetTimeoutMs: 30_000 },
    metrics: {
      successCount: 10,
      failureCount: 2,
      timeoutCount: 1,
      rejectedCount: 0,
      recoveryCount: 0,
      totalExecutions: 13,
      averageLatencyMs: 42,
      lastFailureAt: "2026-01-01T00:00:00.000Z",
      lastSuccessAt: "2026-01-02T00:00:00.000Z",
    },
    openedAt: null,
    ...overrides,
  };
}

describe("application/services/health/dependency-status", () => {
  it("projects a CLOSED breaker as available", () => {
    const status = toDependencyStatus(snapshot({ state: "CLOSED" }));
    expect(status.available).toBe(true);
    expect(status.circuitState).toBe("CLOSED");
  });

  it("projects a HALF_OPEN breaker as available", () => {
    const status = toDependencyStatus(snapshot({ state: "HALF_OPEN" }));
    expect(status.available).toBe(true);
  });

  it("projects an OPEN breaker as unavailable", () => {
    const status = toDependencyStatus(snapshot({ state: "OPEN" }));
    expect(status.available).toBe(false);
  });

  it("errorCount sums failureCount and timeoutCount", () => {
    const status = toDependencyStatus(snapshot());
    expect(status.errorCount).toBe(3);
  });

  it("carries latency and last-success/last-failure through unchanged", () => {
    const status = toDependencyStatus(snapshot());
    expect(status.averageLatencyMs).toBe(42);
    expect(status.lastSuccessfulRequestAt).toBe("2026-01-02T00:00:00.000Z");
    expect(status.lastFailureAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
