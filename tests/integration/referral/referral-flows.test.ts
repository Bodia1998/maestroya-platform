import { beforeEach, describe, expect, it } from "vitest";

import { CreateReferralCodeUseCase } from "@/application/use-cases/referral/create-referral-code.use-case";
import { GetReferralStatisticsUseCase } from "@/application/use-cases/referral/get-referral-statistics.use-case";
import { RecordConversionUseCase } from "@/application/use-cases/referral/record-conversion.use-case";
import { TrackVisitUseCase } from "@/application/use-cases/referral/track-visit.use-case";
import { ConflictError, NotFoundError, ReferralCodeError } from "@/domain/errors/domain-error";
import {
  FakeConversionEventRepository,
  FakeMarketingAttributionRepository,
  FakeReferralCodeRepository,
  FakeReferralVisitRepository,
} from "./fakes";

/**
 * Integration tests for Module 60 — Referral & Marketing Attribution
 * Platform: the tracking/attribution/reporting use cases, exercised
 * against the real domain rules with fake repositories swapped in — same
 * pattern as tests/integration/verification/provider-verification-flows.test.ts.
 */
function makeContext() {
  const codes = new FakeReferralCodeRepository();
  const visits = new FakeReferralVisitRepository();
  const attributions = new FakeMarketingAttributionRepository();
  const conversions = new FakeConversionEventRepository();

  return {
    codes,
    visits,
    attributions,
    conversions,
    createCode: new CreateReferralCodeUseCase(codes),
    trackVisit: new TrackVisitUseCase(visits, attributions, "test-pepper"),
    recordConversion: new RecordConversionUseCase(conversions, attributions),
    statistics: new GetReferralStatisticsUseCase(visits, attributions, conversions),
  };
}

describe("Module 60 — CreateReferralCodeUseCase", () => {
  it("creates a normalized, unique referral code", async () => {
    const ctx = makeContext();
    const code = await ctx.createCode.execute({ code: "Telegram_Valencia", label: "Telegram Valencia group" });
    expect(code.code).toBe("telegram_valencia");
  });

  it("rejects a malformed referral code", async () => {
    const ctx = makeContext();
    await expect(ctx.createCode.execute({ code: "no" })).rejects.toBeInstanceOf(ReferralCodeError);
    await expect(ctx.createCode.execute({ code: "bad code" })).rejects.toBeInstanceOf(ReferralCodeError);
  });

  it("rejects a duplicate referral code", async () => {
    const ctx = makeContext();
    await ctx.createCode.execute({ code: "telegram_valencia" });
    await expect(ctx.createCode.execute({ code: "telegram_valencia" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("Module 60 — TrackVisitUseCase", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("records a first visit and sets first/last touch attribution", async () => {
    const result = await ctx.trackVisit.execute({
      visitorId: "visitor-1",
      referralCode: "telegram_valencia",
      landingPage: "/",
      rawIp: "1.2.3.4",
      userAgent: "TestAgent/1.0",
    });

    expect(result.deduped).toBe(false);
    expect(result.visit).not.toBeNull();
    expect(result.visit!.marketingSource).toBe("REFERRAL");
    expect(result.visit!.ipHash).not.toBeNull();
    expect(result.visit!.ipHash).not.toBe("1.2.3.4");

    expect(result.attribution.firstSource).toBe("REFERRAL");
    expect(result.attribution.firstReferralCode).toBe("telegram_valencia");
    expect(result.attribution.lastSource).toBe("REFERRAL");
  });

  it("resolves DIRECT for a bare visit with no signals", async () => {
    const result = await ctx.trackVisit.execute({ visitorId: "visitor-2", landingPage: "/" });
    expect(result.visit!.marketingSource).toBe("DIRECT");
    expect(result.attribution.firstSource).toBe("DIRECT");
  });

  it("dedups an identical visit within the 60s window and does not create a second visit row", async () => {
    await ctx.trackVisit.execute({ visitorId: "visitor-3", referralCode: "code_a", landingPage: "/" });
    const second = await ctx.trackVisit.execute({ visitorId: "visitor-3", referralCode: "code_a", landingPage: "/" });

    expect(second.deduped).toBe(true);
    expect(second.visit).toBeNull();
    expect(await ctx.visits.countAll()).toBe(1);
  });

  it("keeps first-touch immutable while updating last-touch across multiple non-duplicate visits", async () => {
    const first = await ctx.trackVisit.execute({
      visitorId: "visitor-4",
      referralCode: "telegram_valencia",
      landingPage: "/",
    });
    expect(first.attribution.firstSource).toBe("REFERRAL");

    const second = await ctx.trackVisit.execute({
      visitorId: "visitor-4",
      utmSource: "google_ads",
      utmCampaign: "retarget",
      landingPage: "/pricing",
    });

    expect(second.attribution.firstSource).toBe("REFERRAL");
    expect(second.attribution.firstReferralCode).toBe("telegram_valencia");
    expect(second.attribution.lastSource).toBe("GOOGLE_ADS");
    expect(second.attribution.lastCampaign).toBe("retarget");
  });

  it("treats a malformed referral code as absent rather than failing the visit", async () => {
    const result = await ctx.trackVisit.execute({ visitorId: "visitor-5", referralCode: "bad code!!", landingPage: "/" });
    expect(result.visit!.referralCode).toBeNull();
    expect(result.visit!.marketingSource).not.toBe("REFERRAL");
  });
});

describe("Module 60 — RecordConversionUseCase", () => {
  it("records a conversion event against an existing attribution", async () => {
    const ctx = makeContext();
    const tracked = await ctx.trackVisit.execute({ visitorId: "visitor-6", referralCode: "code_a", landingPage: "/" });

    const conversion = await ctx.recordConversion.execute({
      visitorId: "visitor-6",
      type: "REGISTRATION",
      revenueAmount: null,
    });

    expect(conversion.attributionId).toBe(tracked.attribution.id);
    expect(conversion.type).toBe("REGISTRATION");
  });

  it("throws NotFoundError when no attribution exists for the visitor", async () => {
    const ctx = makeContext();
    await expect(ctx.recordConversion.execute({ visitorId: "never-tracked", type: "REGISTRATION" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("Module 60 — GetReferralStatisticsUseCase", () => {
  it("aggregates visits, top codes/campaigns, and the conversion funnel", async () => {
    const ctx = makeContext();

    await ctx.trackVisit.execute({ visitorId: "v1", referralCode: "code_a", utmCampaign: "spring", landingPage: "/" });
    await ctx.trackVisit.execute({ visitorId: "v2", referralCode: "code_a", utmCampaign: "spring", landingPage: "/" });
    await ctx.trackVisit.execute({ visitorId: "v3", referralCode: "code_b", landingPage: "/" });

    await ctx.recordConversion.execute({ visitorId: "v1", type: "REGISTRATION" });
    await ctx.recordConversion.execute({ visitorId: "v1", type: "CLIENT_REGISTRATION" });
    await ctx.recordConversion.execute({ visitorId: "v1", type: "BOOKING_CREATED" });
    await ctx.recordConversion.execute({ visitorId: "v1", type: "BOOKING_COMPLETED", revenueAmount: 100 });

    const stats = await ctx.statistics.execute();

    expect(stats.totalVisits).toBe(3);
    expect(stats.topReferralCodes[0]).toMatchObject({ referralCode: "code_a", visits: 2 });
    expect(stats.topCampaigns[0]).toMatchObject({ campaign: "spring", visits: 2 });
    expect(stats.registrations).toBe(1);
    expect(stats.clientRegistrations).toBe(1);
    expect(stats.bookingsCreated).toBe(1);
    expect(stats.bookingsCompleted).toBe(1);
    expect(stats.revenueAttributedTotal).toBe(100);
    expect(stats.visitToRegistrationRate).toBeCloseTo(1 / 3);
    expect(stats.registrationToBookingRate).toBe(1);
    expect(stats.bookingCompletionRate).toBe(1);
  });
});
