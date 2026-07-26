import { describe, expect, it } from "vitest";

import { isBelowMinimumInterval, isDuplicateContent } from "@/domain/services/spam-detection";

describe("spam-detection: isDuplicateContent", () => {
  it("is false when there is no recent history", () => {
    expect(isDuplicateContent("hello", [])).toBe(false);
  });

  it("is true when the candidate matches an entry in recent history", () => {
    expect(isDuplicateContent("Hello there", ["something else", "Hello there"])).toBe(true);
  });

  it("is true for trivial case/whitespace variations of prior content", () => {
    expect(isDuplicateContent("HELLO   THERE", ["hello there"])).toBe(true);
  });

  it("is false when the candidate matches nothing in recent history", () => {
    expect(isDuplicateContent("brand new message", ["old message one", "old message two"])).toBe(false);
  });
});

describe("spam-detection: isBelowMinimumInterval", () => {
  const now = new Date("2026-01-01T00:01:00.000Z");

  it("is false when there is no prior action", () => {
    expect(isBelowMinimumInterval(null, now, 60_000)).toBe(false);
  });

  it("is true when the gap since the last action is shorter than the minimum interval", () => {
    const last = new Date(now.getTime() - 10_000); // 10s ago
    expect(isBelowMinimumInterval(last, now, 60_000)).toBe(true);
  });

  it("is false when the gap since the last action meets or exceeds the minimum interval", () => {
    const last = new Date(now.getTime() - 60_000); // exactly 60s ago
    expect(isBelowMinimumInterval(last, now, 60_000)).toBe(false);
  });
});
