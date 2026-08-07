import { describe, expect, it } from "vitest";

import { nextCronOccurrence, parseCronExpression } from "@/infrastructure/jobs/cron-expression";

describe("infrastructure/jobs/cron-expression", () => {
  describe("parseCronExpression", () => {
    it("parses '*' as the full range for each field", () => {
      const parsed = parseCronExpression("* * * * *");
      expect(parsed.minutes.size).toBe(60);
      expect(parsed.hours.size).toBe(24);
      expect(parsed.dayOfMonthRestricted).toBe(false);
      expect(parsed.dayOfWeekRestricted).toBe(false);
    });

    it("parses a single integer field", () => {
      const parsed = parseCronExpression("30 3 * * *");
      expect(parsed.minutes).toEqual(new Set([30]));
      expect(parsed.hours).toEqual(new Set([3]));
    });

    it("parses a range", () => {
      const parsed = parseCronExpression("0 9-17 * * *");
      expect([...parsed.hours].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    });

    it("parses a comma list", () => {
      const parsed = parseCronExpression("0,15,30,45 * * * *");
      expect(parsed.minutes).toEqual(new Set([0, 15, 30, 45]));
    });

    it("parses a step over the full range", () => {
      const parsed = parseCronExpression("*/15 * * * *");
      expect(parsed.minutes).toEqual(new Set([0, 15, 30, 45]));
    });

    it("parses a step over an explicit range", () => {
      const parsed = parseCronExpression("0 8-20/4 * * *");
      expect(parsed.hours).toEqual(new Set([8, 12, 16, 20]));
    });

    it("rejects a value outside a field's range", () => {
      expect(() => parseCronExpression("60 * * * *")).toThrow();
      expect(() => parseCronExpression("* 24 * * *")).toThrow();
    });

    it("rejects a malformed range", () => {
      expect(() => parseCronExpression("5-2 * * * *")).toThrow();
    });

    it("rejects a non-standard extension like '@daily'", () => {
      expect(() => parseCronExpression("@daily")).toThrow();
    });

    it("rejects an expression with the wrong number of fields", () => {
      expect(() => parseCronExpression("* * * *")).toThrow();
      expect(() => parseCronExpression("0 * * * * *")).toThrow();
    });

    it("marks day-of-month/day-of-week restricted only when not '*'", () => {
      const parsed = parseCronExpression("0 0 1 * 1");
      expect(parsed.dayOfMonthRestricted).toBe(true);
      expect(parsed.dayOfWeekRestricted).toBe(true);
    });
  });

  describe("nextCronOccurrence", () => {
    it("finds the next daily occurrence at a fixed hour/minute", () => {
      const parsed = parseCronExpression("0 3 * * *"); // 03:00 UTC daily
      const after = new Date("2026-08-07T01:00:00.000Z");
      const next = nextCronOccurrence(parsed, after);
      expect(next?.toISOString()).toBe("2026-08-07T03:00:00.000Z");
    });

    it("rolls over to the next day once today's occurrence has passed", () => {
      const parsed = parseCronExpression("0 3 * * *");
      const after = new Date("2026-08-07T04:00:00.000Z");
      const next = nextCronOccurrence(parsed, after);
      expect(next?.toISOString()).toBe("2026-08-08T03:00:00.000Z");
    });

    it("is strictly after the given instant, even exactly on a match", () => {
      const parsed = parseCronExpression("0 3 * * *");
      const after = new Date("2026-08-07T03:00:00.000Z");
      const next = nextCronOccurrence(parsed, after);
      expect(next?.toISOString()).toBe("2026-08-08T03:00:00.000Z");
    });

    it("honors an every-15-minutes schedule", () => {
      const parsed = parseCronExpression("*/15 * * * *");
      const after = new Date("2026-08-07T01:02:00.000Z");
      const next = nextCronOccurrence(parsed, after);
      expect(next?.toISOString()).toBe("2026-08-07T01:15:00.000Z");
    });

    it("returns null for an expression that can never match (Feb 30th)", () => {
      const parsed = parseCronExpression("0 0 30 2 *");
      const next = nextCronOccurrence(parsed, new Date("2026-01-01T00:00:00.000Z"));
      expect(next).toBeNull();
    });

    it("applies the day-of-month OR day-of-week rule when both are restricted", () => {
      // 1st of the month OR a Monday, at 00:00 UTC.
      const parsed = parseCronExpression("0 0 1 * 1");
      // 2026-08-03 is a Monday, not the 1st.
      const after = new Date("2026-08-02T00:00:00.000Z");
      const next = nextCronOccurrence(parsed, after);
      expect(next?.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    });
  });
});
