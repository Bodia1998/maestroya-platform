import { describe, expect, it } from "vitest";

import { isQuoteExpirable } from "@/domain/services/quote-expiration-rules";

describe("isQuoteExpirable (Module 28 — Workflow Completion)", () => {
  const now = new Date("2026-08-03T00:00:00Z");
  const past = new Date("2026-08-02T00:00:00Z");
  const future = new Date("2026-08-10T00:00:00Z");

  it("is false when validUntil is null", () => {
    expect(isQuoteExpirable("SENT", null, now)).toBe(false);
  });

  it("is true for PENDING/SENT/VIEWED once validUntil has passed", () => {
    expect(isQuoteExpirable("PENDING", past, now)).toBe(true);
    expect(isQuoteExpirable("SENT", past, now)).toBe(true);
    expect(isQuoteExpirable("VIEWED", past, now)).toBe(true);
  });

  it("is false while validUntil is still in the future", () => {
    expect(isQuoteExpirable("SENT", future, now)).toBe(false);
  });

  it("is false for ACCEPTED/REJECTED/EXPIRED/WITHDRAWN, even if validUntil has passed", () => {
    for (const status of ["ACCEPTED", "REJECTED", "EXPIRED", "WITHDRAWN"] as const) {
      expect(isQuoteExpirable(status, past, now)).toBe(false);
    }
  });
});
