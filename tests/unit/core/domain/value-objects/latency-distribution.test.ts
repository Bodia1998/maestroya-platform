import { describe, expect, it } from "vitest";

import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

describe("domain/value-objects/latency-distribution — LatencyStatistics", () => {
  it("computes min/max/average/median/p95/p99 from an unsorted sample array", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const stats = LatencyStatistics.fromSamples([...samples].reverse());

    expect(stats.sampleCount).toBe(100);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
    expect(stats.average).toBeCloseTo(50.5, 5);
    expect(stats.median).toBe(50); // nearest-rank: ceil(0.5*100)-1 = 49 -> value 50
    expect(stats.p95).toBe(95); // ceil(0.95*100)-1 = 94 -> value 95
    expect(stats.p99).toBe(99); // ceil(0.99*100)-1 = 98 -> value 99
  });

  it("does not mutate the caller's array", () => {
    const samples = [3, 1, 2];
    LatencyStatistics.fromSamples(samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it("handles a single sample (min == max == average == every percentile)", () => {
    const stats = LatencyStatistics.fromSamples([42]);
    expect(stats.min).toBe(42);
    expect(stats.max).toBe(42);
    expect(stats.average).toBe(42);
    expect(stats.median).toBe(42);
    expect(stats.p95).toBe(42);
    expect(stats.p99).toBe(42);
    expect(stats.sampleCount).toBe(1);
  });

  it("rejects an empty sample array", () => {
    expect(() => LatencyStatistics.fromSamples([])).toThrow(RangeError);
  });

  it("rejects a negative or non-finite sample", () => {
    expect(() => LatencyStatistics.fromSamples([1, -1, 2])).toThrow(RangeError);
    expect(() => LatencyStatistics.fromSamples([1, Number.NaN, 2])).toThrow(RangeError);
    expect(() => LatencyStatistics.fromSamples([1, Number.POSITIVE_INFINITY, 2])).toThrow(RangeError);
  });

  it("accepts zero as a valid latency sample", () => {
    const stats = LatencyStatistics.fromSamples([0, 0, 0]);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
  });

  it("round-trips via rehydrate without recomputation", () => {
    const rehydrated = LatencyStatistics.rehydrate({
      sampleCount: 10,
      min: 1,
      max: 100,
      average: 50,
      median: 45,
      p95: 90,
      p99: 99,
    });
    expect(rehydrated.sampleCount).toBe(10);
    expect(rehydrated.p95).toBe(90);
  });
});
