import { describe, expect, it } from "vitest";

import { CacheStatsCollector } from "@/application/services/cache/cache-stats";

describe("application/services/cache/cache-stats", () => {
  it("starts at all zeros with a hit ratio of 0", () => {
    const stats = new CacheStatsCollector();
    expect(stats.snapshot()).toEqual({
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      invalidations: 0,
      errors: 0,
      hitRatio: 0,
    });
  });

  it("counts hits/misses/sets/deletes/errors independently", () => {
    const stats = new CacheStatsCollector();
    stats.recordHit();
    stats.recordHit();
    stats.recordMiss();
    stats.recordSet();
    stats.recordDelete();
    stats.recordError();

    const snapshot = stats.snapshot();
    expect(snapshot.hits).toBe(2);
    expect(snapshot.misses).toBe(1);
    expect(snapshot.sets).toBe(1);
    expect(snapshot.deletes).toBe(1);
    expect(snapshot.errors).toBe(1);
  });

  it("computes hitRatio as hits / (hits + misses)", () => {
    const stats = new CacheStatsCollector();
    stats.recordHit();
    stats.recordHit();
    stats.recordHit();
    stats.recordMiss();

    expect(stats.snapshot().hitRatio).toBe(0.75);
  });

  it("recordInvalidation accumulates the removed-key count, not the number of calls", () => {
    const stats = new CacheStatsCollector();
    stats.recordInvalidation(3);
    stats.recordInvalidation(5);
    expect(stats.snapshot().invalidations).toBe(8);
  });

  it("reset() zeroes every counter", () => {
    const stats = new CacheStatsCollector();
    stats.recordHit();
    stats.recordMiss();
    stats.reset();
    expect(stats.snapshot()).toEqual(
      expect.objectContaining({ hits: 0, misses: 0, hitRatio: 0 }),
    );
  });
});
