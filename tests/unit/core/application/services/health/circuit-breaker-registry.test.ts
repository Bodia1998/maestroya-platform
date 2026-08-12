import { describe, expect, it } from "vitest";

import { CircuitBreakerRegistry } from "@/application/services/health/circuit-breaker-registry";

describe("application/services/health/circuit-breaker-registry", () => {
  it("getOrCreate constructs a breaker on first call and reuses it thereafter", () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.getOrCreate("dep");
    const b = registry.getOrCreate("dep");
    expect(a).toBe(b);
  });

  it("different names are isolated from each other (failure isolation)", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const a = registry.getOrCreate("a");
    const b = registry.getOrCreate("b");

    await expect(a.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(a.currentState).toBe("OPEN");
    expect(b.currentState).toBe("CLOSED");
  });

  it("list/getAllSnapshots reflect every constructed breaker", () => {
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate("a");
    registry.getOrCreate("b");
    expect([...registry.list()].sort()).toEqual(["a", "b"]);
    expect(registry.getAllSnapshots()).toHaveLength(2);
  });

  it("reset() returns false for an unregistered breaker and does not create one", () => {
    const registry = new CircuitBreakerRegistry();
    expect(registry.reset("missing")).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it("reset() forces a specific breaker back to CLOSED", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const breaker = registry.getOrCreate("dep");
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(breaker.currentState).toBe("OPEN");

    expect(registry.reset("dep")).toBe(true);
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("resetAll() resets every breaker", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const a = registry.getOrCreate("a");
    const b = registry.getOrCreate("b");
    await expect(a.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    await expect(b.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();

    registry.resetAll();
    expect(a.currentState).toBe("CLOSED");
    expect(b.currentState).toBe("CLOSED");
  });
});
