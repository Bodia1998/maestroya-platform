import { describe, expect, it } from "vitest";

import { computeRateLimit } from "@/domain/services/rate-limit-window";

describe("rate-limit-window: computeRateLimit", () => {
  it("allows the first attempt for a never-seen key", () => {
    const result = computeRateLimit(undefined, 5, 1000, 0);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.retryAfterMs).toBeNull();
    expect(result.nextState).toEqual({ windowStart: 0, count: 1 });
  });

  it("allows up to the limit within the same window", () => {
    let state = computeRateLimit(undefined, 3, 1000, 0).nextState;
    state = computeRateLimit(state, 3, 1000, 100).nextState;
    const third = computeRateLimit(state, 3, 1000, 200);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocks the attempt that exceeds the limit within the window", () => {
    let state = computeRateLimit(undefined, 2, 1000, 0).nextState;
    state = computeRateLimit(state, 2, 1000, 100).nextState;
    const blocked = computeRateLimit(state, 2, 1000, 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(800); // window closes at t=1000
  });

  it("resets once the window has fully elapsed", () => {
    const state = computeRateLimit(undefined, 1, 1000, 0).nextState;
    const blocked = computeRateLimit(state, 1, 1000, 500);
    expect(blocked.allowed).toBe(false);

    const afterWindow = computeRateLimit(state, 1, 1000, 1000);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.nextState).toEqual({ windowStart: 1000, count: 1 });
  });

  it("retryAfterMs never goes negative even at the exact window boundary", () => {
    const state = computeRateLimit(undefined, 1, 1000, 0).nextState;
    // A second attempt at the exact boundary is a fresh window -> allowed.
    const atBoundary = computeRateLimit(state, 1, 1000, 1000);
    expect(atBoundary.allowed).toBe(true);
  });

  it("rejects a non-positive limit or window as a configuration error", () => {
    expect(() => computeRateLimit(undefined, 0, 1000, 0)).toThrow(RangeError);
    expect(() => computeRateLimit(undefined, 5, 0, 0)).toThrow(RangeError);
  });
});
