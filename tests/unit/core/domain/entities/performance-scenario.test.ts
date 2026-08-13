import { describe, expect, it } from "vitest";

import { PerformanceScenario, WorkloadProfile } from "@/domain/entities/performance-scenario";
import { InvalidWorkloadProfileError } from "@/domain/errors/domain-error";

describe("domain/entities/performance-scenario — WorkloadProfile", () => {
  it("constructs with valid fields", () => {
    const profile = new WorkloadProfile(100, 60, 10, 2);
    expect(profile.virtualUsers).toBe(100);
    expect(profile.durationSeconds).toBe(60);
    expect(profile.rampUpSeconds).toBe(10);
    expect(profile.requestsPerUserPerSecond).toBe(2);
  });

  it("defaults requestsPerUserPerSecond to 1", () => {
    const profile = new WorkloadProfile(10, 30, 5);
    expect(profile.requestsPerUserPerSecond).toBe(1);
  });

  it("computes steadyStateSeconds as duration minus ramp-up", () => {
    const profile = new WorkloadProfile(10, 60, 15);
    expect(profile.steadyStateSeconds).toBe(45);
  });

  it("rejects a non-positive or non-integer virtualUsers", () => {
    expect(() => new WorkloadProfile(0, 60, 10)).toThrow(InvalidWorkloadProfileError);
    expect(() => new WorkloadProfile(-5, 60, 10)).toThrow(InvalidWorkloadProfileError);
    expect(() => new WorkloadProfile(1.5, 60, 10)).toThrow(InvalidWorkloadProfileError);
  });

  it("rejects a non-positive durationSeconds", () => {
    expect(() => new WorkloadProfile(10, 0, 0)).toThrow(InvalidWorkloadProfileError);
    expect(() => new WorkloadProfile(10, -1, 0)).toThrow(InvalidWorkloadProfileError);
  });

  it("rejects a negative rampUpSeconds", () => {
    expect(() => new WorkloadProfile(10, 60, -1)).toThrow(InvalidWorkloadProfileError);
  });

  it("rejects a rampUpSeconds greater than durationSeconds", () => {
    expect(() => new WorkloadProfile(10, 30, 31)).toThrow(InvalidWorkloadProfileError);
  });

  it("rejects a non-positive requestsPerUserPerSecond", () => {
    expect(() => new WorkloadProfile(10, 60, 10, 0)).toThrow(InvalidWorkloadProfileError);
    expect(() => new WorkloadProfile(10, 60, 10, -1)).toThrow(InvalidWorkloadProfileError);
  });

  it("estimates total requests including a half-weighted ramp-up", () => {
    // 10 users * 1 req/s * (5s ramp-up * 0.5 + 10s steady) = 10 * 12.5 = 125
    const profile = new WorkloadProfile(10, 15, 5, 1);
    expect(profile.estimatedTotalRequests()).toBe(125);
  });
});

describe("domain/entities/performance-scenario — PerformanceScenario.define", () => {
  const workloadProfile = new WorkloadProfile(50, 60, 10);

  it("constructs with defaults for thinkTimeMs/weight", () => {
    const scenario = PerformanceScenario.define({
      id: "s1",
      name: "Scenario One",
      category: "AUTHENTICATION",
      description: "test",
      workloadProfile,
    });
    expect(scenario.thinkTimeMs).toBe(0);
    expect(scenario.weight).toBe(1);
  });

  it("rejects an empty id", () => {
    expect(() =>
      PerformanceScenario.define({ id: "  ", name: "x", category: "SEARCH", description: "d", workloadProfile }),
    ).toThrow(InvalidWorkloadProfileError);
  });

  it("rejects a negative thinkTimeMs", () => {
    expect(() =>
      PerformanceScenario.define({ id: "s2", name: "x", category: "SEARCH", description: "d", workloadProfile, thinkTimeMs: -1 }),
    ).toThrow(InvalidWorkloadProfileError);
  });

  it("rejects a non-positive weight", () => {
    expect(() =>
      PerformanceScenario.define({ id: "s3", name: "x", category: "SEARCH", description: "d", workloadProfile, weight: 0 }),
    ).toThrow(InvalidWorkloadProfileError);
  });
});
