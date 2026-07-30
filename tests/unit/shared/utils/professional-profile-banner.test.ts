import { describe, expect, it } from "vitest";

import {
  buildNoProfessionalProfileBanner,
  buildProfessionalProfileBanner,
} from "@/shared/utils/professional-profile-banner";

/**
 * Regression coverage for the persistent profile-completion banner: it
 * previously only rendered as a card on `/dashboard` itself and vanished
 * on every other page. These pure decision functions are what
 * `(dashboard)/layout.tsx` now calls on every page under the route group —
 * see that file's own doc comment for the full wiring.
 */
describe("buildNoProfessionalProfileBanner", () => {
  it("always shows a banner pointing at the professional profile page", () => {
    const info = buildNoProfessionalProfileBanner();

    expect(info.show).toBe(true);
    expect(info.ctaHref).toBe("/dashboard/professional");
    expect(info.message.length).toBeGreaterThan(0);
    expect(info.ctaLabel.length).toBeGreaterThan(0);
  });
});

describe("buildProfessionalProfileBanner", () => {
  const completeSignals = {
    hasHeadlineOrDescription: true,
    hasBioOrDescription: true,
    hasCategories: true,
    hasLocation: true,
    hasAvatarOrLogo: true,
    hasContactInfo: true,
    hasPortfolio: true,
  };

  it("shows no banner once every completeness signal is present", () => {
    const info = buildProfessionalProfileBanner(completeSignals);

    expect(info.show).toBe(false);
  });

  it("shows a banner when any single signal is missing", () => {
    const info = buildProfessionalProfileBanner({ ...completeSignals, hasPortfolio: false });

    expect(info.show).toBe(true);
    expect(info.ctaHref).toBe("/dashboard/professional");
  });

  it("shows a banner for a profile missing most signals (e.g. right after profile creation)", () => {
    const info = buildProfessionalProfileBanner({
      hasHeadlineOrDescription: false,
      hasBioOrDescription: false,
      hasCategories: true,
      hasLocation: false,
      hasAvatarOrLogo: false,
      hasContactInfo: false,
      hasPortfolio: false,
    });

    expect(info.show).toBe(true);
  });

  it("never returns an empty CTA when the banner is shown", () => {
    const info = buildProfessionalProfileBanner({ ...completeSignals, hasCategories: false });

    expect(info.show).toBe(true);
    expect(info.ctaLabel.length).toBeGreaterThan(0);
    expect(info.message.length).toBeGreaterThan(0);
  });
});
