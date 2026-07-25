import { ValidationError } from "@/domain/errors/domain-error";

/**
 * Module 23 — Analytics: a single, shared definition of "date range" used
 * by every platform/professional/customer analytics use case, so the
 * inclusive/exclusive and default-when-omitted rules only need to be
 * decided once instead of subtly differing per use case (the failure mode
 * this file exists to prevent).
 *
 * Timezone: this codebase stores every non-Appointment DateTime as a
 * timezone-naive Postgres timestamp written/read as UTC end-to-end (see
 * schema.prisma's note on Appointment being the one deliberate exception),
 * and every existing date-range-accepting DTO (see
 * financial.dto.ts#getPlatformRevenueSummarySchema) already treats a
 * caller-supplied date as a UTC instant via `z.coerce.date()`. Module 23
 * does not invent a new timezone convention — every `from`/`to` here is
 * likewise a UTC instant, compared directly against stored `createdAt`/
 * `updatedAt` columns with no offset conversion.
 *
 * Boundary semantics (documented once, applies everywhere this type is
 * used):
 *  - Both bounds are INCLUSIVE: a record with `createdAt === from` or
 *    `createdAt === to` is included.
 *  - `from` omitted, `to` provided: every record up to and including `to`.
 *  - `to` omitted, `from` provided: every record from `from` onward,
 *    unbounded above (i.e. "through now").
 *  - Both omitted: unranged — every record, all-time. This matches
 *    GetPlatformRevenueSummaryUseCase's own existing convention (`from`/
 *    `to` both optional there too) rather than introducing a different
 *    "default to last 30 days" behavior Module 22 doesn't already have.
 *  - A caller wanting "through the end of calendar day X" must pass an
 *    instant for the end of that day (e.g. `23:59:59.999Z`) — same
 *    responsibility already placed on the caller by
 *    `getPlatformRevenueSummarySchema`; this module does not add day-
 *    boundary snapping on top of that existing convention.
 */
export interface ResolvedAnalyticsDateRange {
  from: Date | null;
  to: Date | null;
}

export interface AnalyticsDateRangeInput {
  from?: Date;
  to?: Date;
}

/**
 * Validates and normalizes a caller-supplied date range. Throws
 * ValidationError (never lets a malformed range reach a repository query)
 * when:
 *  - `from` is after `to`.
 *  - either value is not a valid Date (an Invalid Date from a failed
 *    `z.coerce.date()` parse would already have been rejected at the DTO
 *    layer, but this is re-checked here since domain services must not
 *    trust their caller either — see the module's "layered validation"
 *    convention already used by CreateFinancialAdjustmentUseCase).
 */
export function resolveAnalyticsDateRange(input: AnalyticsDateRangeInput): ResolvedAnalyticsDateRange {
  const from = input.from ?? null;
  const to = input.to ?? null;

  if (from && Number.isNaN(from.getTime())) {
    throw new ValidationError("Invalid start date.");
  }
  if (to && Number.isNaN(to.getTime())) {
    throw new ValidationError("Invalid end date.");
  }
  if (from && to && from.getTime() > to.getTime()) {
    throw new ValidationError("The start date must be before the end date.");
  }

  return { from, to };
}

// ---------------------------------------------------------------------------
// Time-series aggregation
// ---------------------------------------------------------------------------

export type TimeSeriesGranularity = "DAY" | "WEEK" | "MONTH";

/**
 * Caps how many buckets a time-series query is allowed to materialize.
 * Not a business rule — purely a performance guard so a caller can't
 * request e.g. 20 years of DAY-granularity buckets and force the server to
 * build (and the client to render) tens of thousands of mostly-empty
 * points. Chosen generously enough that no real reporting need is
 * blocked (2 years of daily buckets, ~10 years of weekly, ~20 years of
 * monthly) while still bounding the response size.
 */
const MAX_BUCKETS_BY_GRANULARITY: Record<TimeSeriesGranularity, number> = {
  DAY: 731,
  WEEK: 522,
  MONTH: 240,
};

/**
 * Time-series queries additionally require both `from` and `to` (unlike
 * the plain summary aggregates, which are happy to run unranged) —
 * generating "every day since the platform launched" is exactly the
 * unbounded-array problem `MAX_BUCKETS_BY_GRANULARITY` exists to prevent,
 * so an open-ended time series is rejected outright rather than silently
 * truncated.
 */
export function resolveTimeSeriesRange(
  input: AnalyticsDateRangeInput,
  granularity: TimeSeriesGranularity,
): { from: Date; to: Date } {
  const range = resolveAnalyticsDateRange(input);
  if (!range.from || !range.to) {
    throw new ValidationError("A time-series query requires both a start and end date.");
  }

  const bucketCount = countBuckets(range.from, range.to, granularity);
  if (bucketCount > MAX_BUCKETS_BY_GRANULARITY[granularity]) {
    throw new ValidationError(
      `That date range is too large for ${granularity.toLowerCase()} granularity (max ${MAX_BUCKETS_BY_GRANULARITY[granularity]} buckets). Choose a shorter range or a coarser granularity.`,
    );
  }

  return { from: range.from, to: range.to };
}

function truncateToBucketStart(date: Date, granularity: TimeSeriesGranularity): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (granularity === "DAY") {
    return d;
  }
  if (granularity === "WEEK") {
    // ISO-ish: week starts Monday. getUTCDay(): 0=Sun..6=Sat.
    const day = d.getUTCDay();
    const offsetToMonday = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - offsetToMonday);
    return d;
  }
  // MONTH
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function advanceBucket(date: Date, granularity: TimeSeriesGranularity): Date {
  const d = new Date(date);
  if (granularity === "DAY") {
    d.setUTCDate(d.getUTCDate() + 1);
  } else if (granularity === "WEEK") {
    d.setUTCDate(d.getUTCDate() + 7);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d;
}

function countBuckets(from: Date, to: Date, granularity: TimeSeriesGranularity): number {
  let count = 0;
  let cursor = truncateToBucketStart(from, granularity);
  const end = truncateToBucketStart(to, granularity);
  while (cursor.getTime() <= end.getTime()) {
    count += 1;
    cursor = advanceBucket(cursor, granularity);
    if (count > 100000) break; // hard safety stop, never reached given the caps above
  }
  return count;
}

/**
 * Produces every bucket boundary in `[from, to]` at the given granularity,
 * in ascending order — the deterministic scaffold a use case merges sparse
 * repository results onto so that periods with zero activity are reported
 * as `{ bucketStart, count: 0 }` rather than silently missing from the
 * response (see the module spec's "empty periods handled consistently").
 */
export function generateBucketBoundaries(from: Date, to: Date, granularity: TimeSeriesGranularity): Date[] {
  const boundaries: Date[] = [];
  let cursor = truncateToBucketStart(from, granularity);
  const end = truncateToBucketStart(to, granularity);
  while (cursor.getTime() <= end.getTime()) {
    boundaries.push(new Date(cursor));
    cursor = advanceBucket(cursor, granularity);
  }
  return boundaries;
}

/** Safe ratio helper shared by every conversion-rate/acceptance-rate
 *  calculation in this module — returns `null` (not 0) when the
 *  denominator is 0, since "no data yet" and "0% conversion" are different
 *  facts (same null-for-empty convention as ProfessionalRatingSummary's
 *  `averageRating`). */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}
