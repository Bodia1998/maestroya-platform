import "server-only";

import type { DistributedLock } from "@/application/ports/distributed-lock";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * Single-process `DistributedLock` fallback for environments without
 * `REDIS_URL` configured — provides the same interface and TTL-safety-
 * net semantics as `RedisLockService`, scoped to this one process. This
 * is genuinely correct (not just a stand-in) for a single-instance
 * deployment: within one process, a `Map`-based held-key set with no
 * concurrent-write races (`consume`-style read-modify-write races don't
 * apply — Node.js is single-threaded, and every method here is
 * synchronous *except* awaiting `fn` itself, which happens strictly
 * after the key is already marked held) already gives correct mutual
 * exclusion. Cannot coordinate across multiple instances — never
 * presented as if it could; `createDistributedLock()`
 * (`lock-service-factory.ts`) only returns this when there genuinely is
 * no shared backend to coordinate against.
 */
export class InMemoryLockService implements DistributedLock {
  private readonly held = new Set<string>();

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    if (ttlMs <= 0) {
      throw new RangeError("DistributedLock.withLock: ttlMs must be a positive integer.");
    }

    if (this.held.has(key)) return null;

    this.held.add(key);
    // TTL safety net mirrors RedisLockService's: if `fn` somehow never
    // returns (hangs), the key still self-releases after ttlMs rather
    // than blocking every future attempt forever for the process's
    // lifetime.
    const safetyTimeout = setTimeout(() => this.held.delete(key), ttlMs);

    try {
      return await fn();
    } finally {
      clearTimeout(safetyTimeout);
      this.held.delete(key);
    }
  }
}
