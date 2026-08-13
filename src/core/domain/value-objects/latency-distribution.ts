/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * `LatencyStatistics` is a pure, self-validating value object computed
 * from a set of latency samples (milliseconds) produced by one load-test
 * execution. Deliberately hand-rolled percentile math rather than a
 * statistics dependency — this codebase's convention (see
 * `RetentionPolicy.expiryDateFor`'s own plain-arithmetic approach in
 * `domain/entities/backup.ts`) is that small, well-understood math belongs
 * inline in the domain layer, not behind a third-party package whose
 * behaviour this module would otherwise have to trust blindly.
 *
 * Percentiles use the "nearest-rank" method: for a sorted sample array of
 * length `n`, the p-th percentile is the value at
 * `ceil(p / 100 * n) - 1` (clamped into range). This is the same method
 * most APM/load-testing tools report by default (k6, Gatling) — chosen so
 * this module's numbers are comparable to what an engineer already
 * expects from those tools, not a bespoke interpolation scheme.
 */
export class LatencyStatistics {
  private constructor(
    readonly sampleCount: number,
    readonly min: number,
    readonly max: number,
    readonly average: number,
    readonly median: number,
    readonly p95: number,
    readonly p99: number,
  ) {}

  /**
   * Builds `LatencyStatistics` from raw latency samples. `samplesMs` need
   * not be pre-sorted — this method sorts its own copy, never mutating the
   * caller's array.
   */
  static fromSamples(samplesMs: readonly number[]): LatencyStatistics {
    if (samplesMs.length === 0) {
      throw new RangeError("LatencyStatistics.fromSamples requires at least one latency sample.");
    }
    for (const sample of samplesMs) {
      if (!Number.isFinite(sample) || sample < 0) {
        throw new RangeError(`LatencyStatistics.fromSamples received an invalid latency sample: ${String(sample)}.`);
      }
    }

    const sorted = [...samplesMs].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);

    // Non-null: `sorted.length >= 1` is guaranteed by the empty-array
    // check above, so both endpoints are always present —
    // `noUncheckedIndexedAccess` cannot see that guarantee through the
    // array-copy/sort above.
    return new LatencyStatistics(
      sorted.length,
      sorted[0]!,
      sorted[sorted.length - 1]!,
      sum / sorted.length,
      percentile(sorted, 50),
      percentile(sorted, 95),
      percentile(sorted, 99),
    );
  }

  /** Reconstructs `LatencyStatistics` from already-computed, persisted fields — the repository's own factory, never for a fresh execution's raw samples. */
  static rehydrate(fields: {
    sampleCount: number;
    min: number;
    max: number;
    average: number;
    median: number;
    p95: number;
    p99: number;
  }): LatencyStatistics {
    return new LatencyStatistics(
      fields.sampleCount,
      fields.min,
      fields.max,
      fields.average,
      fields.median,
      fields.p95,
      fields.p99,
    );
  }
}

function percentile(sortedAscending: readonly number[], p: number): number {
  const rank = Math.ceil((p / 100) * sortedAscending.length) - 1;
  const clamped = Math.min(Math.max(rank, 0), sortedAscending.length - 1);
  // Non-null: `clamped` is always a valid index into a non-empty
  // `sortedAscending` — every call site passes the same non-empty
  // `sorted` array `fromSamples` already validated.
  return sortedAscending[clamped]!;
}
