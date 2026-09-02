import { describe, expect, it } from "vitest";

import { decidePurgeRetry } from "@/domain/services/gdpr-cloudinary-purge-policy";

const CONFIG = { maxAttempts: 4, baseDelayMs: 1000 };

describe("Module 94 — decidePurgeRetry", () => {
  it("schedules an exponentially increasing backoff for a transient failure while attempts remain", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = decidePurgeRetry(1, "TRANSIENT", CONFIG, now);
    const second = decidePurgeRetry(2, "TRANSIENT", CONFIG, now);
    const third = decidePurgeRetry(3, "TRANSIENT", CONFIG, now);

    expect(first.deadLetter).toBe(false);
    expect(first.nextAttemptAt).toEqual(new Date(now.getTime() + 1000));
    expect(second.nextAttemptAt).toEqual(new Date(now.getTime() + 2000));
    expect(third.nextAttemptAt).toEqual(new Date(now.getTime() + 4000));
  });

  it("dead-letters once attemptCount reaches maxAttempts, for a retryable category", () => {
    const decision = decidePurgeRetry(CONFIG.maxAttempts, "TRANSIENT", CONFIG);
    expect(decision.deadLetter).toBe(true);
    expect(decision.nextAttemptAt).toBeNull();
  });

  it("never schedules a retry beyond maxAttempts", () => {
    const decision = decidePurgeRetry(CONFIG.maxAttempts + 5, "UNKNOWN", CONFIG);
    expect(decision.deadLetter).toBe(true);
    expect(decision.nextAttemptAt).toBeNull();
  });

  it("treats RATE_LIMITED as retryable, not permanent", () => {
    const decision = decidePurgeRetry(1, "RATE_LIMITED", CONFIG);
    expect(decision.deadLetter).toBe(false);
    expect(decision.nextAttemptAt).not.toBeNull();
  });

  it.each(["AUTHENTICATION", "INVALID_REQUEST"] as const)(
    "dead-letters immediately on a permanent category (%s), even on the very first attempt",
    (category) => {
      const decision = decidePurgeRetry(1, category, CONFIG);
      expect(decision.deadLetter).toBe(true);
      expect(decision.nextAttemptAt).toBeNull();
    },
  );

  it("caps the computed delay at the shared MAX_BACKOFF_MS (1 hour), never growing unbounded", () => {
    const decision = decidePurgeRetry(20, "TRANSIENT", { maxAttempts: 25, baseDelayMs: 60_000 });
    expect(decision.deadLetter).toBe(false);
    expect(decision.nextAttemptAt).not.toBeNull();
    const delayMs = decision.nextAttemptAt!.getTime() - Date.now();
    expect(delayMs).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });
});
