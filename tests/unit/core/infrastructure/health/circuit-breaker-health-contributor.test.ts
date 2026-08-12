import { describe, expect, it } from "vitest";

import { CircuitBreakerRegistry } from "@/application/services/health/circuit-breaker-registry";
import { createCircuitBreakerHealthContributor } from "@/infrastructure/health/circuit-breaker-health-contributor";

describe("infrastructure/health/circuit-breaker-health-contributor", () => {
  it("adapts a healthy raw report into a HEALTHY outcome with details", async () => {
    const registry = new CircuitBreakerRegistry();
    const contributor = createCircuitBreakerHealthContributor({
      name: "dep",
      registry,
      collect: () => ({ status: "ok", latencyMs: 5 }),
    });

    const outcome = await contributor.check();
    expect(outcome.status).toBe("HEALTHY");
    expect(outcome.details).toEqual({ latencyMs: 5 });
  });

  it("adapts a raw error status into UNHEALTHY", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 5 });
    const contributor = createCircuitBreakerHealthContributor({
      name: "dep",
      registry,
      collect: () => ({ status: "error" }),
    });

    const outcome = await contributor.check();
    expect(outcome.status).toBe("UNHEALTHY");
  });

  it("a throwing collector trips its breaker, and reports UNHEALTHY with the error message", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const contributor = createCircuitBreakerHealthContributor({
      name: "dep",
      registry,
      collect: async () => {
        throw new Error("connection refused");
      },
    });

    const outcome = await contributor.check();
    expect(outcome.status).toBe("UNHEALTHY");
    expect(outcome.error).toContain("connection refused");
    expect(registry.get("dep")?.currentState).toBe("OPEN");
  });

  it("once the breaker is OPEN, reports UNHEALTHY with circuitState OPEN without invoking the collector again", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    let calls = 0;
    const contributor = createCircuitBreakerHealthContributor({
      name: "dep",
      registry,
      collect: async () => {
        calls += 1;
        throw new Error("down");
      },
    });

    await contributor.check(); // trips the breaker
    const outcome = await contributor.check(); // breaker now OPEN

    expect(outcome.status).toBe("UNHEALTHY");
    expect(outcome.details).toMatchObject({ circuitState: "OPEN" });
    expect(calls).toBe(1);
  });

  it("failures in one dependency's breaker never affect another's", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const broken = createCircuitBreakerHealthContributor({
      name: "broken",
      registry,
      collect: async () => {
        throw new Error("down");
      },
    });
    const healthy = createCircuitBreakerHealthContributor({
      name: "healthy",
      registry,
      collect: () => ({ status: "ok" }),
    });

    await broken.check();
    const healthyOutcome = await healthy.check();

    expect(registry.get("broken")?.currentState).toBe("OPEN");
    expect(healthyOutcome.status).toBe("HEALTHY");
    expect(registry.get("healthy")?.currentState).toBe("CLOSED");
  });
});
