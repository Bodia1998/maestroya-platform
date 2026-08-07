/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * Pure, dependency-free hit/miss/invalidation counters for a single
 * `CacheManager` instance. Deliberately in-memory and per-process — same
 * accepted trade-off `InMemoryRateLimitRepository`/`InMemoryCacheService`
 * already document for their own state: on a multi-instance deployment
 * each instance reports only its own traffic, which is a real limitation
 * for a global dashboard but never a correctness problem (it is
 * observability, not a cache-consistency mechanism). A future module
 * wanting cross-instance aggregation would sum these from each
 * instance's own `/api/health/ready` snapshot (see `cache-health.ts`)
 * rather than needing a new distributed-counter backend.
 */
export interface CacheStatsSnapshot {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  invalidations: number;
  errors: number;
  /** `hits / (hits + misses)`, or `0` when there have been no reads at all. */
  hitRatio: number;
}

export class CacheStatsCollector {
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private deletes = 0;
  private invalidations = 0;
  private errors = 0;

  recordHit(): void {
    this.hits += 1;
  }

  recordMiss(): void {
    this.misses += 1;
  }

  recordSet(): void {
    this.sets += 1;
  }

  recordDelete(): void {
    this.deletes += 1;
  }

  /** `count` is the number of keys an invalidation actually removed. */
  recordInvalidation(count: number): void {
    this.invalidations += count;
  }

  recordError(): void {
    this.errors += 1;
  }

  snapshot(): CacheStatsSnapshot {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      deletes: this.deletes,
      invalidations: this.invalidations,
      errors: this.errors,
      hitRatio: total === 0 ? 0 : this.hits / total,
    };
  }

  /** Exposed for tests only. */
  reset(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
    this.invalidations = 0;
    this.errors = 0;
  }
}
