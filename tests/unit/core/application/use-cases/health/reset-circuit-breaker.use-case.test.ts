import { describe, expect, it } from "vitest";

import { CircuitBreakerRegistry } from "@/application/services/health/circuit-breaker-registry";
import { ResetCircuitBreakerUseCase } from "@/application/use-cases/health/reset-circuit-breaker.use-case";

describe("application/use-cases/health/reset-circuit-breaker", () => {
  it("resets a single named breaker", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const breaker = registry.getOrCreate("dep");
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();

    const result = new ResetCircuitBreakerUseCase(registry).execute({ name: "dep" });
    expect(result).toEqual({ reset: ["dep"], notFound: [] });
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("reports notFound for an unregistered breaker", () => {
    const registry = new CircuitBreakerRegistry();
    const result = new ResetCircuitBreakerUseCase(registry).execute({ name: "missing" });
    expect(result).toEqual({ reset: [], notFound: ["missing"] });
  });

  it("'all' resets every registered breaker", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const a = registry.getOrCreate("a");
    const b = registry.getOrCreate("b");
    await expect(a.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    await expect(b.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();

    const result = new ResetCircuitBreakerUseCase(registry).execute({ name: "all" });
    expect([...result.reset].sort()).toEqual(["a", "b"]);
    expect(a.currentState).toBe("CLOSED");
    expect(b.currentState).toBe("CLOSED");
  });
});
