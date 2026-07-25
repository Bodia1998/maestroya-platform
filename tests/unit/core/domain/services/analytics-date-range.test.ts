import { describe, expect, it } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import {
  generateBucketBoundaries,
  resolveAnalyticsDateRange,
  resolveTimeSeriesRange,
  safeRatio,
} from "@/domain/services/analytics-date-range";

describe("resolveAnalyticsDateRange", () => {
  it("returns null/null when neither from nor to is given (unranged, all-time)", () => {
    expect(resolveAnalyticsDateRange({})).toEqual({ from: null, to: null });
  });

  it("accepts from-only (open-ended upper bound)", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(resolveAnalyticsDateRange({ from })).toEqual({ from, to: null });
  });

  it("accepts to-only (open-ended lower bound)", () => {
    const to = new Date("2026-01-31T23:59:59.999Z");
    expect(resolveAnalyticsDateRange({ to })).toEqual({ from: null, to });
  });

  it("accepts from === to (a single-instant inclusive range)", () => {
    const instant = new Date("2026-01-15T12:00:00Z");
    expect(resolveAnalyticsDateRange({ from: instant, to: instant })).toEqual({ from: instant, to: instant });
  });

  it("rejects from > to", () => {
    expect(() =>
      resolveAnalyticsDateRange({ from: new Date("2026-02-01"), to: new Date("2026-01-01") }),
    ).toThrow(ValidationError);
  });

  it("rejects an Invalid Date", () => {
    expect(() => resolveAnalyticsDateRange({ from: new Date("not-a-date") })).toThrow(ValidationError);
  });
});

describe("resolveTimeSeriesRange", () => {
  it("requires both from and to", () => {
    expect(() => resolveTimeSeriesRange({ from: new Date("2026-01-01") }, "DAY")).toThrow(ValidationError);
    expect(() => resolveTimeSeriesRange({ to: new Date("2026-01-01") }, "DAY")).toThrow(ValidationError);
    expect(() => resolveTimeSeriesRange({}, "DAY")).toThrow(ValidationError);
  });

  it("accepts a reasonable DAY-granularity range", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-31T00:00:00Z");
    expect(resolveTimeSeriesRange({ from, to }, "DAY")).toEqual({ from, to });
  });

  it("rejects a DAY-granularity range spanning more than the configured cap", () => {
    const from = new Date("2020-01-01T00:00:00Z");
    const to = new Date("2026-01-01T00:00:00Z"); // ~6 years of days
    expect(() => resolveTimeSeriesRange({ from, to }, "DAY")).toThrow(ValidationError);
  });

  it("accepts the same multi-year range at MONTH granularity", () => {
    const from = new Date("2020-01-01T00:00:00Z");
    const to = new Date("2024-01-01T00:00:00Z");
    expect(() => resolveTimeSeriesRange({ from, to }, "MONTH")).not.toThrow();
  });
});

describe("generateBucketBoundaries", () => {
  it("produces one boundary per day, inclusive of both ends", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-03T00:00:00Z");
    const boundaries = generateBucketBoundaries(from, to, "DAY");
    expect(boundaries).toHaveLength(3);
    expect(boundaries[0]?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(boundaries[2]?.toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });

  it("truncates a mid-day instant down to its bucket start", () => {
    const from = new Date("2026-01-01T15:30:00Z");
    const to = new Date("2026-01-01T18:00:00Z");
    const boundaries = generateBucketBoundaries(from, to, "DAY");
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("produces deterministic, ascending MONTH boundaries", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const to = new Date("2026-03-01T00:00:00Z");
    const boundaries = generateBucketBoundaries(from, to, "MONTH");
    expect(boundaries.map((d) => d.toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-10T00:00:00Z");
    const first = generateBucketBoundaries(from, to, "DAY").map((d) => d.toISOString());
    const second = generateBucketBoundaries(from, to, "DAY").map((d) => d.toISOString());
    expect(first).toEqual(second);
  });
});

describe("safeRatio", () => {
  it("returns null (not 0) for a zero denominator", () => {
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(5, 0)).toBeNull();
  });

  it("returns the ratio for a positive denominator", () => {
    expect(safeRatio(1, 4)).toBe(0.25);
    expect(safeRatio(0, 4)).toBe(0);
  });
});
