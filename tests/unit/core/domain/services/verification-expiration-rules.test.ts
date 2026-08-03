import { describe, expect, it } from "vitest";

import { isVerificationExpirable } from "@/domain/services/verification-expiration-rules";

describe("isVerificationExpirable (Module 28 — Workflow Completion)", () => {
  const now = new Date("2026-08-03T00:00:00Z");
  const past = new Date("2026-08-02T00:00:00Z");
  const future = new Date("2026-08-10T00:00:00Z");

  it("is false when expiresAt is null", () => {
    expect(isVerificationExpirable("APPROVED", null, now)).toBe(false);
  });

  it("is true only for APPROVED once expiresAt has passed", () => {
    expect(isVerificationExpirable("APPROVED", past, now)).toBe(true);
  });

  it("is false while expiresAt is still in the future", () => {
    expect(isVerificationExpirable("APPROVED", future, now)).toBe(false);
  });

  it("is false for any non-APPROVED status, even if expiresAt has passed", () => {
    for (const status of ["DRAFT", "PENDING", "UNDER_REVIEW", "REJECTED", "RESUBMISSION_REQUIRED", "EXPIRED"]) {
      expect(isVerificationExpirable(status, past, now)).toBe(false);
    }
  });

  it("works identically for the company-verification status set (same string values)", () => {
    expect(isVerificationExpirable("APPROVED", past, now)).toBe(true);
    expect(isVerificationExpirable("EXPIRED", past, now)).toBe(false);
  });
});
