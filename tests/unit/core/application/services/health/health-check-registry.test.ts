import { describe, expect, it } from "vitest";

import { HealthCheckRegistry } from "@/application/services/health/health-check-registry";
import type { HealthContributor } from "@/application/ports/health-contributor";

function contributor(name: string, outcome: Awaited<ReturnType<HealthContributor["check"]>>): HealthContributor {
  return { name, check: async () => outcome };
}

describe("application/services/health/health-check-registry", () => {
  it("returns HEALTHY with no checks when nothing is registered", async () => {
    const registry = new HealthCheckRegistry();
    const report = await registry.runAll();
    expect(report.status).toBe("HEALTHY");
    expect(report.checks).toEqual([]);
  });

  it("aggregates worst-status-wins across registered contributors", async () => {
    const registry = new HealthCheckRegistry();
    registry.register(contributor("a", { status: "HEALTHY" }));
    registry.register(contributor("b", { status: "DEGRADED" }));
    registry.register(contributor("c", { status: "HEALTHY" }));

    const report = await registry.runAll();
    expect(report.status).toBe("DEGRADED");
    expect(report.checks).toHaveLength(3);
  });

  it("attaches component name, responseTimeMs, and timestamp to every result", async () => {
    const registry = new HealthCheckRegistry();
    registry.register(contributor("db", { status: "HEALTHY", details: { foo: "bar" } }));

    const report = await registry.runAll();
    const [check] = report.checks;
    expect(check?.component).toBe("db");
    expect(check?.status).toBe("HEALTHY");
    expect(check?.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(check?.timestamp).toBeTruthy();
    expect(check?.details).toEqual({ foo: "bar" });
  });

  it("a contributor that throws is reported as UNHEALTHY, never aborting the whole report", async () => {
    const registry = new HealthCheckRegistry();
    registry.register({
      name: "broken",
      check: async () => {
        throw new Error("kaboom");
      },
    });
    registry.register(contributor("ok", { status: "HEALTHY" }));

    const report = await registry.runAll();
    expect(report.status).toBe("UNHEALTHY");
    const broken = report.checks.find((c) => c.component === "broken");
    expect(broken?.status).toBe("UNHEALTHY");
    expect(broken?.error).toBe("kaboom");
  });

  it("runByName returns null for an unregistered contributor", async () => {
    const registry = new HealthCheckRegistry();
    expect(await registry.runByName("nope")).toBeNull();
  });

  it("unregister removes a contributor from subsequent runs", async () => {
    const registry = new HealthCheckRegistry();
    registry.register(contributor("a", { status: "HEALTHY" }));
    registry.unregister("a");
    expect(registry.list()).toEqual([]);
    const report = await registry.runAll();
    expect(report.checks).toEqual([]);
  });
});
