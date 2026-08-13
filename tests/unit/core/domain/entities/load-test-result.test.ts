import { describe, expect, it } from "vitest";

import { LoadTestResult } from "@/domain/entities/load-test-result";
import { InvalidLoadTestTransitionError } from "@/domain/errors/domain-error";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function completionDetails(overrides: Partial<Parameters<LoadTestResult["markCompleted"]>[0]> = {}) {
  return {
    latency: LatencyStatistics.fromSamples([10, 20, 30]),
    throughput: { requestsPerSecond: 100, transactionsPerSecond: 95 },
    resourceEstimate: { cpuPercent: 40, memoryMB: 512, dbConnectionPoolUtilizationPercent: 30, cacheHitRatioPercent: 80 },
    totalRequests: 100,
    failedRequests: 5,
    timedOutRequests: 1,
    retriedRequests: 2,
    ...overrides,
  };
}

describe("domain/entities/load-test-result — LoadTestResult lifecycle", () => {
  it("starts PENDING and moves through RUNNING -> COMPLETED", () => {
    const result = LoadTestResult.schedule("r1", "authentication", 42, t0);
    expect(result.status).toBe("PENDING");
    expect(result.seed).toBe(42);

    result.markRunning(t0);
    expect(result.status).toBe("RUNNING");
    expect(result.startedAt).toBe(t0);

    const completedAt = new Date("2026-01-01T00:01:00.000Z");
    result.markCompleted(completionDetails(), completedAt);
    expect(result.status).toBe("COMPLETED");
    expect(result.completedAt).toBe(completedAt);
    expect(result.totalRequests).toBe(100);
    expect(result.failedRequests).toBe(5);
  });

  it("rejects an illegal transition (e.g. PENDING -> COMPLETED)", () => {
    const result = LoadTestResult.schedule("r2", "authentication", null, t0);
    expect(() => result.markCompleted(completionDetails(), t0)).toThrow(InvalidLoadTestTransitionError);
  });

  it("rejects RUNNING -> RUNNING", () => {
    const result = LoadTestResult.schedule("r3", "authentication", null, t0);
    result.markRunning(t0);
    expect(() => result.markRunning(t0)).toThrow(InvalidLoadTestTransitionError);
  });

  it("rejects any transition out of a terminal COMPLETED state", () => {
    const result = LoadTestResult.schedule("r4", "authentication", null, t0);
    result.markRunning(t0);
    result.markCompleted(completionDetails(), t0);
    expect(() => result.markRunning(t0)).toThrow(InvalidLoadTestTransitionError);
    expect(() => result.markFailed("x", t0)).toThrow(InvalidLoadTestTransitionError);
  });

  it("rejects any transition out of a terminal FAILED state", () => {
    const result = LoadTestResult.schedule("r5", "authentication", null, t0);
    result.markRunning(t0);
    result.markFailed("boom", t0);
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("boom");
    expect(() => result.markRunning(t0)).toThrow(InvalidLoadTestTransitionError);
  });

  it("rejects completion where failedRequests exceeds totalRequests", () => {
    const result = LoadTestResult.schedule("r6", "authentication", null, t0);
    result.markRunning(t0);
    expect(() => result.markCompleted(completionDetails({ totalRequests: 10, failedRequests: 20 }), t0)).toThrow(
      InvalidLoadTestTransitionError,
    );
  });

  it("computes errorRate/timeoutRate/retryRate from completion details", () => {
    const result = LoadTestResult.schedule("r7", "authentication", null, t0);
    result.markRunning(t0);
    result.markCompleted(completionDetails({ totalRequests: 100, failedRequests: 10, timedOutRequests: 4, retriedRequests: 8 }), t0);
    expect(result.errorRate).toBeCloseTo(0.1, 10);
    expect(result.timeoutRate).toBeCloseTo(0.04, 10);
    expect(result.retryRate).toBeCloseTo(0.08, 10);
  });

  it("reports a 0 error/timeout/retry rate for a run with zero totalRequests, never NaN", () => {
    const result = LoadTestResult.schedule("r8", "authentication", null, t0);
    expect(result.errorRate).toBe(0);
    expect(result.timeoutRate).toBe(0);
    expect(result.retryRate).toBe(0);
  });

  it("round-trips via rehydrate", () => {
    const rehydrated = LoadTestResult.rehydrate({
      id: "r9",
      scenarioId: "authentication",
      seed: 7,
      status: "COMPLETED",
      scheduledAt: t0,
      startedAt: t0,
      completedAt: t0,
      latency: LatencyStatistics.fromSamples([1, 2, 3]),
      throughput: { requestsPerSecond: 10, transactionsPerSecond: 9 },
      resourceEstimate: { cpuPercent: 10, memoryMB: 100, dbConnectionPoolUtilizationPercent: 10, cacheHitRatioPercent: 50 },
      totalRequests: 3,
      failedRequests: 1,
      timedOutRequests: 0,
      retriedRequests: 0,
      failureReason: null,
    });
    expect(rehydrated.status).toBe("COMPLETED");
    expect(rehydrated.seed).toBe(7);
  });
});
