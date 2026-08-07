import type { CacheProvider } from "@/application/ports/cache-provider";

/**
 * Module 46 — Caching Layer: a minimal, in-memory `CacheProvider` test
 * double for unit-testing `CacheManager`/`CacheInvalidator`/`CacheNamespace`
 * without depending on `InMemoryCacheProvider`'s own implementation (that
 * class has its own dedicated test file) or a real/fake Redis server.
 * Supports the same TTL and `*`-glob `deletePattern` semantics real
 * implementations do, plus an `failNextOperation` escape hatch for
 * exercising this module's "a provider error degrades to a safe
 * miss/no-op" behavior.
 */
export class FakeCacheProvider implements CacheProvider {
  readonly store = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly failQueue: Error[] = [];

  /**
   * Queues `error` to be thrown by the next call to any method — call
   * multiple times to fail several calls in a row (e.g. `CacheManager`'s
   * own version lookup issues a `provider.get()` before the operation a
   * test actually cares about; queuing two failures lets a test reach
   * past that internal lookup to the operation under test).
   */
  failNextOperation(error: Error): void {
    this.failQueue.push(error);
  }

  private maybeThrow(): void {
    const error = this.failQueue.shift();
    if (error) throw error;
  }

  async get<T>(key: string): Promise<T | null> {
    this.maybeThrow();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.maybeThrow();
    if (ttlMs <= 0) throw new RangeError("ttlMs must be positive");
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.maybeThrow();
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    this.maybeThrow();
    return (await this.get(key)) !== null;
  }

  async deletePattern(pattern: string): Promise<number> {
    this.maybeThrow();
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (regex.test(key)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
