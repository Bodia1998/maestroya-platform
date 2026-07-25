import { describe, expect, it } from "vitest";

import { computeProfileCompleteness } from "@/domain/services/profile-completeness";

const ALL_TRUE = {
  hasHeadlineOrDescription: true,
  hasBioOrDescription: true,
  hasCategories: true,
  hasLocation: true,
  hasAvatarOrLogo: true,
  hasContactInfo: true,
  hasPortfolio: true,
};

describe("computeProfileCompleteness", () => {
  it("returns 1 when every signal is present", () => {
    expect(computeProfileCompleteness(ALL_TRUE)).toBe(1);
  });

  it("returns 0 when every signal is absent", () => {
    const allFalse = Object.fromEntries(Object.keys(ALL_TRUE).map((key) => [key, false])) as typeof ALL_TRUE;
    expect(computeProfileCompleteness(allFalse)).toBe(0);
  });

  it("returns a proportional fraction for partial completeness", () => {
    const partial = {
      ...ALL_TRUE,
      hasAvatarOrLogo: false,
      hasContactInfo: false,
      hasPortfolio: false,
      hasLocation: false,
    };
    // 3 of 7 signals present
    expect(computeProfileCompleteness(partial)).toBeCloseTo(3 / 7, 5);
  });

  it("is deterministic and independent of key order", () => {
    const a = computeProfileCompleteness(ALL_TRUE);
    const reordered = {
      hasPortfolio: true,
      hasContactInfo: true,
      hasAvatarOrLogo: true,
      hasLocation: true,
      hasCategories: true,
      hasBioOrDescription: true,
      hasHeadlineOrDescription: true,
    };
    const b = computeProfileCompleteness(reordered);
    expect(a).toBe(b);
  });
});
