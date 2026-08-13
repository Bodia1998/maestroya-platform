import { describe, expect, it } from "vitest";

import {
  applyAttributionTouch,
  EMPTY_ATTRIBUTION_TOUCH_STATE,
} from "@/domain/services/marketing-attribution-touch-rules";

describe("Module 60 — marketing-attribution-touch-rules", () => {
  it("sets both first-touch and last-touch fields on the first-ever touch", () => {
    const firstVisitAt = new Date("2026-08-01T00:00:00.000Z");
    const state = applyAttributionTouch(EMPTY_ATTRIBUTION_TOUCH_STATE, {
      source: "TELEGRAM",
      campaign: "spring_launch",
      referralCode: "telegram_valencia",
      visitAt: firstVisitAt,
    });

    expect(state.firstSource).toBe("TELEGRAM");
    expect(state.firstCampaign).toBe("spring_launch");
    expect(state.firstReferralCode).toBe("telegram_valencia");
    expect(state.firstVisitAt).toEqual(firstVisitAt);
    expect(state.lastSource).toBe("TELEGRAM");
    expect(state.lastVisitAt).toEqual(firstVisitAt);
  });

  it("never overwrites an already-set first touch on a later touch", () => {
    const firstVisitAt = new Date("2026-08-01T00:00:00.000Z");
    const secondVisitAt = new Date("2026-08-05T00:00:00.000Z");

    const afterFirst = applyAttributionTouch(EMPTY_ATTRIBUTION_TOUCH_STATE, {
      source: "TELEGRAM",
      campaign: "spring_launch",
      referralCode: "telegram_valencia",
      visitAt: firstVisitAt,
    });

    const afterSecond = applyAttributionTouch(afterFirst, {
      source: "GOOGLE_ADS",
      campaign: "google_retarget",
      referralCode: null,
      visitAt: secondVisitAt,
    });

    expect(afterSecond.firstSource).toBe("TELEGRAM");
    expect(afterSecond.firstCampaign).toBe("spring_launch");
    expect(afterSecond.firstReferralCode).toBe("telegram_valencia");
    expect(afterSecond.firstVisitAt).toEqual(firstVisitAt);
  });

  it("always overwrites last-touch fields on every subsequent touch", () => {
    const firstVisitAt = new Date("2026-08-01T00:00:00.000Z");
    const secondVisitAt = new Date("2026-08-05T00:00:00.000Z");

    const afterFirst = applyAttributionTouch(EMPTY_ATTRIBUTION_TOUCH_STATE, {
      source: "TELEGRAM",
      campaign: "spring_launch",
      referralCode: "telegram_valencia",
      visitAt: firstVisitAt,
    });

    const afterSecond = applyAttributionTouch(afterFirst, {
      source: "GOOGLE_ADS",
      campaign: "google_retarget",
      referralCode: null,
      visitAt: secondVisitAt,
    });

    expect(afterSecond.lastSource).toBe("GOOGLE_ADS");
    expect(afterSecond.lastCampaign).toBe("google_retarget");
    expect(afterSecond.lastReferralCode).toBeNull();
    expect(afterSecond.lastVisitAt).toEqual(secondVisitAt);
  });

  it("does not mutate the state passed in", () => {
    const before = { ...EMPTY_ATTRIBUTION_TOUCH_STATE };
    applyAttributionTouch(EMPTY_ATTRIBUTION_TOUCH_STATE, {
      source: "DIRECT",
      campaign: null,
      referralCode: null,
      visitAt: new Date(),
    });
    expect(EMPTY_ATTRIBUTION_TOUCH_STATE).toEqual(before);
  });
});
