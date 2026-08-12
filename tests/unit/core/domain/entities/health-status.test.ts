import { describe, expect, it } from "vitest";

import { aggregateHealthStatus } from "@/domain/entities/health-status";

describe("domain/entities/health-status", () => {
  it("returns HEALTHY for an empty list", () => {
    expect(aggregateHealthStatus([])).toBe("HEALTHY");
  });

  it("returns HEALTHY when every status is HEALTHY", () => {
    expect(aggregateHealthStatus(["HEALTHY", "HEALTHY"])).toBe("HEALTHY");
  });

  it("returns DEGRADED when the worst status is DEGRADED", () => {
    expect(aggregateHealthStatus(["HEALTHY", "DEGRADED", "HEALTHY"])).toBe("DEGRADED");
  });

  it("returns UNHEALTHY when any status is UNHEALTHY, even alongside DEGRADED", () => {
    expect(aggregateHealthStatus(["DEGRADED", "UNHEALTHY", "HEALTHY"])).toBe("UNHEALTHY");
  });
});
