import { describe, expect, it, vi } from "vitest";

import type { LoadTestExecutionOutcome, LoadTestExecutor } from "@/application/ports/load-test-executor";
import { LoadTestingService } from "@/application/services/performance/load-testing-service";
import { PerformanceScenario, WorkloadProfile } from "@/domain/entities/performance-scenario";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function makeScenario(): PerformanceScenario {
  return PerformanceScenario.define({
    id: "authentication",
    name: "Authentication",
    category: "AUTHENTICATION",
    description: "test",
    workloadProfile: new WorkloadProfile(10, 60, 10),
  });
}

const successOutcome: LoadTestExecutionOutcome = {
  samples: [
    { latencyMs: 100, succeeded: true, timedOut: false, retried: false },
    { latencyMs: 120, succeeded: true, timedOut: false, retried: false },
    { latencyMs: 5000, succeeded: false, timedOut: true, retried: true },
  ],
  resourceEstimate: { cpuPercent: 20, memoryMB: 256, dbConnectionPoolUtilizationPercent: 10, cacheHitRatioPercent: 60 },
};

describe("application/services/performance/load-testing-service — LoadTestingService.run", () => {
  it("schedules, runs, and completes a load test entirely in memory, with no persistence", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const service = new LoadTestingService({ executor, generateId: () => "result-1", now: () => t0 });

    const result = await service.run(makeScenario(), 7);

    expect(result.status).toBe("COMPLETED");
    expect(result.id).toBe("result-1");
    expect(result.totalRequests).toBe(3);
    expect(result.failedRequests).toBe(1);
    expect(result.timedOutRequests).toBe(1);
    expect(result.retriedRequests).toBe(1);
    expect(result.latency?.sampleCount).toBe(3);
    expect(executor.execute).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("derives a stable seed when the caller omits one, rather than using non-deterministic randomness", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const service = new LoadTestingService({ executor, generateId: () => "same-id", now: () => t0 });

    await service.run(makeScenario());
    const firstSeed = (executor.execute as ReturnType<typeof vi.fn>).mock.calls.at(0)?.[1];

    await service.run(makeScenario());
    const secondSeed = (executor.execute as ReturnType<typeof vi.fn>).mock.calls.at(1)?.[1];

    expect(firstSeed).toBe(secondSeed);
    expect(typeof firstSeed).toBe("number");
  });

  it("marks the result FAILED and re-throws when the executor rejects", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => Promise.reject(new Error("simulator crashed"))) };
    const service = new LoadTestingService({ executor, generateId: () => "result-2", now: () => t0 });

    await expect(service.run(makeScenario())).rejects.toThrow("simulator crashed");
  });

  it("fails the run when the executor produces zero samples", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => ({ samples: [], resourceEstimate: successOutcome.resourceEstimate })) };
    const service = new LoadTestingService({ executor, generateId: () => "result-3", now: () => t0 });

    await expect(service.run(makeScenario())).rejects.toThrow(/zero samples/);
  });
});
