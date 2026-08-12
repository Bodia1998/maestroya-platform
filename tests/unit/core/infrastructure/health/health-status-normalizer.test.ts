import { describe, expect, it } from "vitest";

import { normalizeHealthStatus } from "@/infrastructure/health/health-status-normalizer";

describe("infrastructure/health/health-status-normalizer", () => {
  it.each(["ok", "healthy", "disabled", "not_configured", "bypassed"])("normalizes %s to HEALTHY", (raw) => {
    expect(normalizeHealthStatus(raw)).toBe("HEALTHY");
  });

  it.each(["degraded", "at_risk", "starting"])("normalizes %s to DEGRADED", (raw) => {
    expect(normalizeHealthStatus(raw)).toBe("DEGRADED");
  });

  it.each(["error", "unavailable", "unhealthy", "down"])("normalizes %s to UNHEALTHY", (raw) => {
    expect(normalizeHealthStatus(raw)).toBe("UNHEALTHY");
  });

  it("is case-insensitive", () => {
    expect(normalizeHealthStatus("OK")).toBe("HEALTHY");
    expect(normalizeHealthStatus("Error")).toBe("UNHEALTHY");
  });

  it("treats an unrecognized status conservatively as DEGRADED", () => {
    expect(normalizeHealthStatus("something-new")).toBe("DEGRADED");
  });
});
