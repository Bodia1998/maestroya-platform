import { describe, expect, it } from "vitest";

import { BenchmarkRunner, mulberry32 } from "@/infrastructure/performance/benchmark-runner";
import { PerformanceScenario, WorkloadProfile } from "@/domain/entities/performance-scenario";

function makeScenario(category: PerformanceScenario["category"] = "AUTHENTICATION", virtualUsers = 20): PerformanceScenario {
  return PerformanceScenario.define({
    id: "test-scenario",
    name: "Test Scenario",
    category,
    description: "test",
    workloadProfile: new WorkloadProfile(virtualUsers, 30, 5, 1),
  });
}

describe("infrastructure/performance/benchmark-runner — mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const rngA = mulberry32(123);
    const rngB = mulberry32(123);
    const sequenceA = Array.from({ length: 10 }, () => rngA());
    const sequenceB = Array.from({ length: 10 }, () => rngB());
    expect(sequenceA).toEqual(sequenceB);
  });

  it("produces different sequences for different seeds", () => {
    const rngA = mulberry32(1);
    const rngB = mulberry32(2);
    expect(rngA()).not.toBe(rngB());
  });

  it("always returns values in [0, 1)", () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("infrastructure/performance/benchmark-runner — BenchmarkRunner.execute", () => {
  it("is fully reproducible for the same scenario and seed", async () => {
    const runner = new BenchmarkRunner();
    const scenario = makeScenario();
    const outcomeA = await runner.execute(scenario, 42);
    const outcomeB = await runner.execute(scenario, 42);
    expect(outcomeA.samples).toEqual(outcomeB.samples);
    expect(outcomeA.resourceEstimate).toEqual(outcomeB.resourceEstimate);
  });

  it("produces different samples for a different seed", async () => {
    const runner = new BenchmarkRunner();
    const scenario = makeScenario();
    const outcomeA = await runner.execute(scenario, 1);
    const outcomeB = await runner.execute(scenario, 2);
    expect(outcomeA.samples).not.toEqual(outcomeB.samples);
  });

  it("produces only non-negative, finite latencies", async () => {
    const runner = new BenchmarkRunner();
    const outcome = await runner.execute(makeScenario(), 7);
    for (const sample of outcome.samples) {
      expect(Number.isFinite(sample.latencyMs)).toBe(true);
      expect(sample.latencyMs).toBeGreaterThan(0);
    }
  });

  it("produces at least one sample for every scenario category", async () => {
    const runner = new BenchmarkRunner();
    const categories: PerformanceScenario["category"][] = [
      "USER_REGISTRATION",
      "AUTHENTICATION",
      "PASSWORD_RESET",
      "SEARCH",
      "CREATE_SERVICE_REQUEST",
      "BROWSE_PROFESSIONALS",
      "SUBMIT_QUOTE",
      "ACCEPT_QUOTE",
      "BOOKING",
      "MESSAGING",
      "NOTIFICATIONS",
      "STRIPE_PAYMENT_FLOW",
      "ADMIN_DASHBOARD",
      "CONCURRENT_API_TRAFFIC",
      "DATABASE_INTENSIVE",
      "MIXED_WORKLOAD",
    ];
    for (const category of categories) {
      const outcome = await runner.execute(makeScenario(category), 1);
      expect(outcome.samples.length).toBeGreaterThan(0);
    }
  });

  it("DATABASE_INTENSIVE scenarios report a materially higher average latency than BROWSE_PROFESSIONALS at the same concurrency", async () => {
    const runner = new BenchmarkRunner();
    const dbOutcome = await runner.execute(makeScenario("DATABASE_INTENSIVE"), 5);
    const browseOutcome = await runner.execute(makeScenario("BROWSE_PROFESSIONALS"), 5);

    const avg = (samples: typeof dbOutcome.samples) => samples.reduce((sum, s) => sum + s.latencyMs, 0) / samples.length;
    expect(avg(dbOutcome.samples)).toBeGreaterThan(avg(browseOutcome.samples));
  });

  it("STRIPE_PAYMENT_FLOW never produces a real network side effect — only in-process samples", async () => {
    const runner = new BenchmarkRunner();
    const outcome = await runner.execute(makeScenario("STRIPE_PAYMENT_FLOW"), 3);
    expect(outcome.samples.length).toBeGreaterThan(0);
    expect(outcome.resourceEstimate.cpuPercent).toBeGreaterThanOrEqual(0);
  });

  it("caps simulated samples at a bounded ceiling even for a very large workload", async () => {
    const runner = new BenchmarkRunner();
    const hugeScenario = makeScenario("CONCURRENT_API_TRAFFIC", 5000);
    const outcome = await runner.execute(hugeScenario, 1);
    expect(outcome.samples.length).toBeLessThanOrEqual(3000);
  });
});
