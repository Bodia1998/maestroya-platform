import { describe, expect, it, vi } from "vitest";

import { InMemoryLockService } from "@/infrastructure/locking/in-memory-lock-service";

describe("infrastructure/locking/in-memory-lock-service", () => {
  it("runs fn and returns its result when the lock is free", async () => {
    const lock = new InMemoryLockService();
    const result = await lock.withLock("job:1", 5000, async () => "done");
    expect(result).toBe("done");
  });

  it("releases the lock after fn completes, allowing immediate re-acquisition", async () => {
    const lock = new InMemoryLockService();
    await lock.withLock("job:1", 5000, async () => "first");
    const second = await lock.withLock("job:1", 5000, async () => "second");
    expect(second).toBe("second");
  });

  it("returns null without calling fn when the key is already held", async () => {
    const lock = new InMemoryLockService();
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstCall = lock.withLock("job:1", 5000, async () => {
      await firstHeld;
      return "first";
    });

    // Give the first call a tick to actually mark the key held.
    await Promise.resolve();

    const fnSpy = vi.fn(async () => "second");
    const secondResult = await lock.withLock("job:1", 5000, fnSpy);

    expect(secondResult).toBeNull();
    expect(fnSpy).not.toHaveBeenCalled();

    releaseFirst();
    await expect(firstCall).resolves.toBe("first");
  });

  it("releases the lock even when fn throws", async () => {
    const lock = new InMemoryLockService();

    await expect(
      lock.withLock("job:1", 5000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const afterThrow = await lock.withLock("job:1", 5000, async () => "recovered");
    expect(afterThrow).toBe("recovered");
  });

  it("self-releases after ttlMs even if fn never resolves (safety net)", async () => {
    vi.useFakeTimers();
    const lock = new InMemoryLockService();

    // Deliberately never resolves — simulates a stuck/hung operation.
    void lock.withLock("job:1", 1000, () => new Promise(() => {}));

    vi.advanceTimersByTime(1001);
    // Give the timer callback's microtask a chance to run.
    await vi.advanceTimersByTimeAsync(0);

    const fnSpy = vi.fn(async () => "recovered");
    const result = await lock.withLock("job:1", 1000, fnSpy);
    expect(result).toBe("recovered");

    vi.useRealTimers();
  });

  it("rejects a non-positive ttlMs", async () => {
    const lock = new InMemoryLockService();
    await expect(lock.withLock("job:1", 0, async () => "x")).rejects.toThrow(RangeError);
  });

  it("keeps independent locks per key", async () => {
    const lock = new InMemoryLockService();
    let releaseA!: () => void;
    const heldA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const callA = lock.withLock("a", 5000, async () => {
      await heldA;
      return "a";
    });
    await Promise.resolve();

    const resultB = await lock.withLock("b", 5000, async () => "b");
    expect(resultB).toBe("b");

    releaseA();
    await expect(callA).resolves.toBe("a");
  });
});
