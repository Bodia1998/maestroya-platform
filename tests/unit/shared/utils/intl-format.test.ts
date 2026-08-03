import { describe, expect, it } from "vitest";

import { createLocaleFormatter, currencyFractionDigits } from "@/shared/utils/intl-format";

describe("date and time", () => {
  const date = new Date(Date.UTC(2026, 2, 9, 10, 30, 0));

  it("formats per locale, with no hardcoded pattern anywhere", () => {
    expect(createLocaleFormatter("en").date(date, "long")).toContain("March");
    expect(createLocaleFormatter("de").date(date, "long")).toContain("März");
    expect(createLocaleFormatter("uk").date(date, "long")).toContain("2026");
  });

  it("accepts strings and epoch millis, and returns empty for junk", () => {
    const f = createLocaleFormatter("en");
    expect(f.date(date.toISOString())).not.toBe("");
    expect(f.date(date.getTime())).not.toBe("");
    expect(f.date("not-a-date")).toBe("");
  });
});

describe("numbers and currency", () => {
  it("uses locale-appropriate separators", () => {
    expect(createLocaleFormatter("en").number(1234567.89)).toBe("1,234,567.89");
    // Polish groups with a (narrow, non-breaking) space and uses a comma
    // decimal separator — the exact space codepoint is a CLDR detail that
    // has changed between ICU versions, so it is normalised here rather
    // than pinned.
    expect(createLocaleFormatter("pl").number(1234567.89).replace(/\s/g, " ")).toBe("1 234 567,89");
  });

  it("formats EUR by default and honours an explicit currency", () => {
    const es = createLocaleFormatter("es");
    expect(es.currency(1234.5)).toContain("€");
    expect(createLocaleFormatter("en").currency(10, "USD")).toContain("$");
  });

  it("converts integer minor units using the currency's own exponent", () => {
    const en = createLocaleFormatter("en");
    // The shape a Stripe amount arrives in. EUR/USD: 2 decimals.
    expect(en.currencyFromMinorUnits(1250, "EUR")).toBe("€12.50");
    // JPY has zero decimals — a hardcoded /100 would render ¥12.5 here.
    expect(currencyFractionDigits("en", "JPY")).toBe(0);
    expect(en.currencyFromMinorUnits(1250, "JPY")).toBe("¥1,250");
  });

  it("formats percentages, rounding to whole units unless told otherwise", () => {
    // Intl's default for `style: "percent"` is 0 fraction digits.
    expect(createLocaleFormatter("en").percent(0.075)).toBe("8%");
    expect(createLocaleFormatter("en").percent(0.075, { maximumFractionDigits: 1 })).toBe("7.5%");
  });

  it("returns empty for non-finite input rather than 'NaN'", () => {
    const f = createLocaleFormatter("en");
    expect(f.number(Number.NaN)).toBe("");
    expect(f.currency(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("relative time", () => {
  const now = new Date(Date.UTC(2026, 0, 10, 12, 0, 0));

  it("picks the largest unit that fits, in both directions", () => {
    const f = createLocaleFormatter("en");
    expect(f.relativeTime(new Date(Date.UTC(2026, 0, 7, 12, 0, 0)), now)).toBe("3 days ago");
    expect(f.relativeTime(new Date(Date.UTC(2026, 0, 10, 14, 0, 0)), now)).toBe("in 2 hours");
    expect(f.relativeTime(new Date(Date.UTC(2026, 0, 9, 12, 0, 0)), now)).toBe("yesterday");
  });

  it("localises", () => {
    const value = new Date(Date.UTC(2026, 0, 7, 12, 0, 0));
    expect(createLocaleFormatter("es").relativeTime(value, now)).toContain("días");
  });

  it("collapses sub-second deltas to 'now'", () => {
    expect(createLocaleFormatter("en").relativeTime(now, now)).toBe("now");
  });
});

describe("lists", () => {
  it("joins with the locale's own conjunction", () => {
    expect(createLocaleFormatter("en").list(["a", "b", "c"])).toBe("a, b, and c");
    expect(createLocaleFormatter("es").list(["a", "b", "c"])).toBe("a, b y c");
  });
});
