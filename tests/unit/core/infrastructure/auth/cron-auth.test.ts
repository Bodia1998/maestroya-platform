import { describe, expect, it } from "vitest";

import { isValidCronAuthHeader } from "@/infrastructure/auth/cron-auth";

/**
 * Module 95 — API Security Hardening. Regression coverage for the
 * timing-safe `Authorization: Bearer $CRON_SECRET` comparison every cron
 * route in this codebase now shares (see cron-auth.ts's own doc comment
 * for why the previous plain `!==` string comparison was a finding).
 */
describe("isValidCronAuthHeader", () => {
  it("accepts an exact match", () => {
    expect(isValidCronAuthHeader("Bearer correct-secret", "correct-secret")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isValidCronAuthHeader(null, "correct-secret")).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(isValidCronAuthHeader("Bearer wrong-secretttt", "correct-secretx")).toBe(false);
  });

  it("rejects a shorter guess (never throws on a length mismatch)", () => {
    expect(isValidCronAuthHeader("Bearer c", "correct-secret")).toBe(false);
  });

  it("rejects a longer guess (never throws on a length mismatch)", () => {
    expect(isValidCronAuthHeader("Bearer correct-secret-and-then-some", "correct-secret")).toBe(false);
  });

  it("rejects a header missing the Bearer prefix even with the right secret", () => {
    expect(isValidCronAuthHeader("correct-secret", "correct-secret")).toBe(false);
  });

  it("is case-sensitive on the secret", () => {
    expect(isValidCronAuthHeader("Bearer Correct-Secret", "correct-secret")).toBe(false);
  });
});
