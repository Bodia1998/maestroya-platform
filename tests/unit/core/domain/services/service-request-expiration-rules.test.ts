import { describe, expect, it } from "vitest";

import { isServiceRequestExpirable } from "@/domain/services/service-request-expiration-rules";

describe("isServiceRequestExpirable (Module 28 — Workflow Completion)", () => {
  const now = new Date("2026-08-03T00:00:00Z");
  const past = new Date("2026-08-02T00:00:00Z");
  const future = new Date("2026-08-10T00:00:00Z");

  it("is false when expiresAt is null", () => {
    expect(isServiceRequestExpirable("PUBLISHED", null, now)).toBe(false);
  });

  it("is true for PUBLISHED/QUOTED once expiresAt has passed", () => {
    expect(isServiceRequestExpirable("PUBLISHED", past, now)).toBe(true);
    expect(isServiceRequestExpirable("QUOTED", past, now)).toBe(true);
  });

  it("is true exactly at the boundary instant (<=)", () => {
    expect(isServiceRequestExpirable("PUBLISHED", now, now)).toBe(true);
  });

  it("is false while expiresAt is still in the future", () => {
    expect(isServiceRequestExpirable("PUBLISHED", future, now)).toBe(false);
  });

  it("is false for statuses outside PUBLISHED/QUOTED, even if expiresAt has passed", () => {
    for (const status of ["DRAFT", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED"] as const) {
      expect(isServiceRequestExpirable(status, past, now)).toBe(false);
    }
  });
});
