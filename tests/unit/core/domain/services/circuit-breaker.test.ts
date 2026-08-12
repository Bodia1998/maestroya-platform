import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker } from "@/domain/services/circuit-breaker";
import { CircuitBreakerOpenError } from "@/domain/errors/circuit-breaker-open-error";
import { CircuitBreakerTimeoutError } from "@/domain/errors/circuit-breaker-timeout-error";

function fakeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("domain/services/circuit-breaker", () => {
  it("starts CLOSED", () => {
    const breaker = new CircuitBreaker("test");
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("stays CLOSED and records successes", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3 });
    await breaker.execute(async () => "ok");
    await breaker.execute(async () => "ok");

    const snapshot = breaker.getSnapshot();
    expect(snapshot.state).toBe("CLOSED");
    expect(snapshot.metrics.successCount).toBe(2);
    expect(snapshot.metrics.failureCount).toBe(0);
  });

  it("trips to OPEN after failureThreshold consecutive failures", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    }
    expect(breaker.currentState).toBe("OPEN");
    expect(breaker.getSnapshot().metrics.failureCount).toBe(3);
  });

  it("a success resets the consecutive-failure counter, so failureThreshold requires them to be consecutive", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3 });
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    await breaker.execute(async () => "ok");
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();

    expect(breaker.currentState).toBe("CLOSED");
  });

  it("rejects immediately with CircuitBreakerOpenError while OPEN, without invoking the wrapped function", async () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 10_000 }, clock.now);
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(breaker.currentState).toBe("OPEN");

    const fn = vi.fn(async () => "should not run");
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
    expect(breaker.getSnapshot().metrics.rejectedCount).toBe(1);
  });

  it("transitions OPEN -> HALF_OPEN after resetTimeoutMs elapses", async () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 1000 }, clock.now);
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(breaker.currentState).toBe("OPEN");

    clock.advance(999);
    expect(breaker.currentState).toBe("OPEN");

    clock.advance(2);
    expect(breaker.currentState).toBe("HALF_OPEN");
  });

  it("closes after successThreshold consecutive successes in HALF_OPEN, and records a recovery", async () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, successThreshold: 2, resetTimeoutMs: 100 }, clock.now);
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    clock.advance(200);
    expect(breaker.currentState).toBe("HALF_OPEN");

    await breaker.execute(async () => "ok");
    expect(breaker.currentState).toBe("HALF_OPEN");
    await breaker.execute(async () => "ok");
    expect(breaker.currentState).toBe("CLOSED");
    expect(breaker.getSnapshot().metrics.recoveryCount).toBe(1);
  });

  it("a single failure in HALF_OPEN re-opens immediately, without needing failureThreshold failures", async () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker("test", { failureThreshold: 5, resetTimeoutMs: 100 }, clock.now);
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    }
    clock.advance(200);
    expect(breaker.currentState).toBe("HALF_OPEN");

    await expect(breaker.execute(async () => Promise.reject(new Error("still broken")))).rejects.toThrow();
    expect(breaker.currentState).toBe("OPEN");
  });

  it("times out a call that exceeds timeoutMs, recording it as a timeout not a plain failure", async () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker("test", { timeoutMs: 50, failureThreshold: 10 });
      const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 10_000));

      const promise = breaker.execute(slow);
      const assertion = expect(promise).rejects.toBeInstanceOf(CircuitBreakerTimeoutError);
      await vi.advanceTimersByTimeAsync(50);
      await assertion;

      const metrics = breaker.getSnapshot().metrics;
      expect(metrics.timeoutCount).toBe(1);
      expect(metrics.failureCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("manual reset() forces CLOSED regardless of current state", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 10_000 });
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(breaker.currentState).toBe("OPEN");

    breaker.reset();
    expect(breaker.currentState).toBe("CLOSED");
    expect(breaker.getSnapshot().openedAt).toBeNull();
  });

  it("getSnapshot reports averageLatencyMs and success/failure timestamps", async () => {
    const breaker = new CircuitBreaker("test");
    await breaker.execute(async () => "ok");
    const snapshot = breaker.getSnapshot();
    expect(snapshot.metrics.averageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.metrics.lastSuccessAt).not.toBeNull();
    expect(snapshot.metrics.lastFailureAt).toBeNull();
    expect(snapshot.name).toBe("test");
  });
});
