import { describe, expect, it } from "vitest";

import { computeBackoffDelayMs, MAX_BACKOFF_MS } from "@/infrastructure/jobs/backoff";

describe("infrastructure/jobs/backoff", () => {
  it("fixed backoff waits the same delay on every attempt", () => {
    expect(computeBackoffDelayMs(1, { type: "fixed", delay: 1000 })).toBe(1000);
    expect(computeBackoffDelayMs(5, { type: "fixed", delay: 1000 })).toBe(1000);
  });

  it("exponential backoff doubles from the base delay: 1s, 2s, 4s, 8s...", () => {
    const backoff = { type: "exponential" as const, delay: 1000 };
    expect(computeBackoffDelayMs(1, backoff)).toBe(1000);
    expect(computeBackoffDelayMs(2, backoff)).toBe(2000);
    expect(computeBackoffDelayMs(3, backoff)).toBe(4000);
    expect(computeBackoffDelayMs(4, backoff)).toBe(8000);
  });

  it("caps the computed delay at MAX_BACKOFF_MS", () => {
    const backoff = { type: "exponential" as const, delay: 1000 };
    expect(computeBackoffDelayMs(20, backoff)).toBe(MAX_BACKOFF_MS);
  });

  it("rejects attemptsMade below 1", () => {
    expect(() => computeBackoffDelayMs(0, { type: "fixed", delay: 1000 })).toThrow(RangeError);
  });

  it("without jitter, the delay is deterministic", () => {
    const backoff = { type: "fixed" as const, delay: 1000 };
    expect(computeBackoffDelayMs(1, backoff, () => 0.999)).toBe(1000);
  });

  it("jitter only ever shortens the delay, never lengthens it", () => {
    const backoff = { type: "fixed" as const, delay: 1000, jitter: 0.2 };
    expect(computeBackoffDelayMs(1, backoff, () => 0)).toBe(1000); // no randomness spent -> full delay
    expect(computeBackoffDelayMs(1, backoff, () => 1)).toBe(800); // max randomness -> full 20% shaved off
    expect(computeBackoffDelayMs(1, backoff, () => 0.5)).toBe(900);
  });

  it("clamps jitter above 1 to 1 (never negative delay)", () => {
    const backoff = { type: "fixed" as const, delay: 1000, jitter: 5 };
    expect(computeBackoffDelayMs(1, backoff, () => 1)).toBe(0);
  });

  it("never returns a negative delay", () => {
    const backoff = { type: "fixed" as const, delay: 100, jitter: 1 };
    const delay = computeBackoffDelayMs(1, backoff, () => 1);
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});
