/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * A minimal standard 5-field cron parser (`minute hour day-of-month
 * month day-of-week`), used only by `job-scheduler.ts` to answer one
 * question: "given `after`, when is this expression next due?".
 *
 * Hand-rolled for the same reason `redis-protocol.ts` is (Module 44): no
 * npm-registry access in this environment, so `cron-parser` — the
 * package BullMQ itself uses — cannot be installed. Scope is
 * deliberately the portable POSIX subset and nothing more: `*`, integers,
 * `a-b` ranges, `a,b,c` lists, and step values (`*` with a `/n` suffix, or
 * `a-b` with a `/n` suffix). Non-standard
 * extensions (`@daily`, `L`, `W`, `#`, seconds as a 6th field, named
 * months/days) are rejected loudly at parse time rather than silently
 * mis-scheduled — a schedule that quietly never fires is far worse than
 * one that refuses to be configured.
 *
 * All evaluation is in **UTC**, matching `vercel.json`'s existing cron
 * schedule (`"0 3 * * *"` is documented as 03:00 UTC in
 * `api/cron/expire-workflows/route.ts`), so the two scheduling systems
 * can never disagree about what a given expression means.
 *
 * Day-of-month and day-of-week follow the standard (surprising, but
 * correct) cron rule: when *both* are restricted, a day matches if it
 * satisfies *either*; when only one is restricted, only that one applies.
 */

export interface ParsedCronExpression {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
  /** Whether the corresponding field was `*` — needed for the day-of-month/day-of-week OR rule. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 6 },
];

export function parseCronExpression(expression: string): ParsedCronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression ${JSON.stringify(expression)}: expected 5 space-separated fields ` +
        `(minute hour day-of-month month day-of-week), received ${parts.length}.`,
    );
  }

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parts.map((part, index) =>
    parseField(part, FIELDS[index]!, expression),
  );

  return {
    minutes: minutes!,
    hours: hours!,
    daysOfMonth: daysOfMonth!,
    months: months!,
    daysOfWeek: daysOfWeek!,
    dayOfMonthRestricted: parts[2] !== "*",
    dayOfWeekRestricted: parts[4] !== "*",
  };
}

function parseField(field: string, spec: FieldSpec, expression: string): Set<number> {
  const values = new Set<number>();

  for (const term of field.split(",")) {
    const [rangePart, stepPart, ...rest] = term.split("/");
    if (rest.length > 0 || rangePart === undefined || rangePart === "") {
      throw new Error(`Invalid ${spec.name} term ${JSON.stringify(term)} in cron expression ${JSON.stringify(expression)}.`);
    }

    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid ${spec.name} step ${JSON.stringify(stepPart)} in cron expression ${JSON.stringify(expression)}.`);
    }

    let from: number;
    let to: number;
    if (rangePart === "*") {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes("-")) {
      const [rawFrom, rawTo, ...extra] = rangePart.split("-");
      from = Number(rawFrom);
      to = Number(rawTo);
      if (extra.length > 0 || !isInRange(from, spec) || !isInRange(to, spec) || from > to) {
        throw new Error(`Invalid ${spec.name} range ${JSON.stringify(rangePart)} in cron expression ${JSON.stringify(expression)}.`);
      }
    } else {
      from = Number(rangePart);
      to = from;
      if (!isInRange(from, spec)) {
        throw new Error(
          `Invalid ${spec.name} value ${JSON.stringify(rangePart)} in cron expression ${JSON.stringify(expression)} ` +
            `(expected an integer between ${spec.min} and ${spec.max}).`,
        );
      }
    }

    for (let value = from; value <= to; value += step) values.add(value);
  }

  return values;
}

function isInRange(value: number, spec: FieldSpec): boolean {
  return Number.isInteger(value) && value >= spec.min && value <= spec.max;
}

/**
 * The first instant strictly after `after` that matches `parsed`, in UTC.
 *
 * Implemented as a minute-by-minute scan rather than field arithmetic:
 * bounded to `MAX_SCAN_MINUTES` (~4 years of minutes) it is fast enough
 * for the once-per-schedule call site, and it is far harder to get
 * subtly wrong around month lengths, leap years, and the day-of-month/
 * day-of-week OR rule than a clever closed-form implementation would be.
 * Returns `null` for an expression that can never match (e.g.
 * `0 0 30 2 *` — February 30th).
 */
const MAX_SCAN_MINUTES = 4 * 366 * 24 * 60;

export function nextCronOccurrence(parsed: ParsedCronExpression, after: Date): Date | null {
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let scanned = 0; scanned < MAX_SCAN_MINUTES; scanned += 1) {
    if (matches(parsed, cursor)) return cursor;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return null;
}

function matches(parsed: ParsedCronExpression, at: Date): boolean {
  if (!parsed.minutes.has(at.getUTCMinutes())) return false;
  if (!parsed.hours.has(at.getUTCHours())) return false;
  if (!parsed.months.has(at.getUTCMonth() + 1)) return false;

  const dayOfMonthMatches = parsed.daysOfMonth.has(at.getUTCDate());
  const dayOfWeekMatches = parsed.daysOfWeek.has(at.getUTCDay());

  if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }
  return dayOfMonthMatches && dayOfWeekMatches;
}
