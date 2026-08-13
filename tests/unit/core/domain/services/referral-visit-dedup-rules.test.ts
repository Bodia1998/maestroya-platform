import { describe, expect, it } from "vitest";

import { isDuplicateVisit, VISIT_DEDUP_WINDOW_MS, type VisitSignature } from "@/domain/services/referral-visit-dedup-rules";

function signature(overrides: Partial<VisitSignature> = {}): VisitSignature {
  return {
    visitorId: "visitor-1",
    referralCode: "code_a",
    utmSource: "telegram",
    utmMedium: null,
    utmCampaign: null,
    landingPage: "/",
    createdAt: new Date("2026-08-13T12:00:00.000Z"),
    ...overrides,
  };
}

describe("Module 60 — referral-visit-dedup-rules", () => {
  it("flags an identical visit within the dedup window as a duplicate", () => {
    const candidate = signature({ createdAt: new Date("2026-08-13T12:00:30.000Z") });
    expect(isDuplicateVisit(candidate, [signature()])).toBe(true);
  });

  it("flags a visit at exactly the window boundary as a duplicate", () => {
    const candidate = signature({ createdAt: new Date(signature().createdAt.getTime() + VISIT_DEDUP_WINDOW_MS) });
    expect(isDuplicateVisit(candidate, [signature()])).toBe(true);
  });

  it("does not flag a visit just outside the window as a duplicate", () => {
    const candidate = signature({ createdAt: new Date(signature().createdAt.getTime() + VISIT_DEDUP_WINDOW_MS + 1) });
    expect(isDuplicateVisit(candidate, [signature()])).toBe(false);
  });

  it("does not flag a different visitor as a duplicate", () => {
    const candidate = signature({ visitorId: "visitor-2", createdAt: new Date("2026-08-13T12:00:10.000Z") });
    expect(isDuplicateVisit(candidate, [signature()])).toBe(false);
  });

  it("does not flag a different referral code as a duplicate", () => {
    const candidate = signature({ referralCode: "code_b", createdAt: new Date("2026-08-13T12:00:10.000Z") });
    expect(isDuplicateVisit(candidate, [signature()])).toBe(false);
  });

  it("does not flag a different landing page as a duplicate", () => {
    const candidate = signature({ landingPage: "/other", createdAt: new Date("2026-08-13T12:00:10.000Z") });
    expect(isDuplicateVisit(candidate, [signature()])).toBe(false);
  });

  it("returns false against an empty history", () => {
    expect(isDuplicateVisit(signature(), [])).toBe(false);
  });
});
