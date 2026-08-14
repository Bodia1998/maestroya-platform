import { beforeEach, describe, expect, it } from "vitest";

import { CreateReferralCodeUseCase } from "@/application/use-cases/referral/create-referral-code.use-case";
import { RecordConversionUseCase } from "@/application/use-cases/referral/record-conversion.use-case";
import { TrackVisitUseCase } from "@/application/use-cases/referral/track-visit.use-case";
import { ApprovePartnerUseCase } from "@/application/use-cases/affiliate/approve-partner.use-case";
import { RejectPartnerUseCase } from "@/application/use-cases/affiliate/reject-partner.use-case";
import { SuspendPartnerUseCase } from "@/application/use-cases/affiliate/suspend-partner.use-case";
import { BanPartnerUseCase } from "@/application/use-cases/affiliate/ban-partner.use-case";
import { RegisterPartnerUseCase } from "@/application/use-cases/affiliate/register-partner.use-case";
import { GeneratePartnerReferralLinkUseCase } from "@/application/use-cases/affiliate/generate-partner-referral-link.use-case";
import { RecordAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/record-affiliate-commission.use-case";
import { ApproveAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/approve-affiliate-commission.use-case";
import { CancelAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/cancel-affiliate-commission.use-case";
import { ExpireAffiliateCommissionsUseCase } from "@/application/use-cases/affiliate/expire-affiliate-commissions.use-case";
import { CreatePartnerPayoutUseCase } from "@/application/use-cases/affiliate/create-partner-payout.use-case";
import { GetPartnerDashboardStatisticsUseCase } from "@/application/use-cases/affiliate/get-partner-dashboard-statistics.use-case";
import { DetectPartnerFraudSignalsUseCase } from "@/application/use-cases/affiliate/detect-partner-fraud-signals.use-case";
import { ConflictError, InvalidPartnerTransitionError, NotFoundError, PartnerNotActiveError, ValidationError } from "@/domain/errors/domain-error";
import {
  FakeConversionEventRepository,
  FakeMarketingAttributionRepository,
  FakeReferralCodeRepository,
  FakeReferralVisitRepository,
} from "../referral/fakes";
import {
  FakeAffiliateCommissionRepository,
  FakePartnerFraudFlagRepository,
  FakePartnerPayoutRepository,
  FakePartnerRepository,
} from "./fakes";

/**
 * Integration tests for Module 61 — Affiliate & Partner System, exercised
 * against the real domain rules with fake repositories swapped in — same
 * pattern as tests/integration/referral/referral-flows.test.ts. Reuses
 * Module 60's own fakes (../referral/fakes) rather than re-implementing
 * referral/attribution behavior, matching this module's "reuse, don't
 * duplicate" mandate.
 */
function makeContext() {
  const partners = new FakePartnerRepository();
  const referralCodes = new FakeReferralCodeRepository();
  const visits = new FakeReferralVisitRepository();
  const attributions = new FakeMarketingAttributionRepository();
  const conversions = new FakeConversionEventRepository();
  const affiliateCommissions = new FakeAffiliateCommissionRepository();
  const payouts = new FakePartnerPayoutRepository();
  const fraudFlags = new FakePartnerFraudFlagRepository();

  return {
    partners,
    referralCodes,
    visits,
    attributions,
    conversions,
    affiliateCommissions,
    payouts,
    fraudFlags,
    registerPartner: new RegisterPartnerUseCase(partners),
    approvePartner: new ApprovePartnerUseCase(partners),
    rejectPartner: new RejectPartnerUseCase(partners),
    suspendPartner: new SuspendPartnerUseCase(partners),
    banPartner: new BanPartnerUseCase(partners),
    generateLink: new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(referralCodes)),
    trackVisit: new TrackVisitUseCase(visits, attributions, "test-pepper"),
    recordConversion: new RecordConversionUseCase(conversions, attributions),
    recordAffiliateCommission: new RecordAffiliateCommissionUseCase(attributions, referralCodes, partners, affiliateCommissions),
    approveAffiliateCommission: new ApproveAffiliateCommissionUseCase(affiliateCommissions),
    cancelAffiliateCommission: new CancelAffiliateCommissionUseCase(affiliateCommissions),
    expireAffiliateCommissions: new ExpireAffiliateCommissionsUseCase(affiliateCommissions),
    createPayout: new CreatePartnerPayoutUseCase(partners, affiliateCommissions, payouts),
    dashboardStats: new GetPartnerDashboardStatisticsUseCase(partners, referralCodes, visits, attributions, conversions, affiliateCommissions),
    detectFraud: new DetectPartnerFraudSignalsUseCase(partners, referralCodes, visits, attributions, conversions, fraudFlags),
  };
}

async function approvedPartner(ctx: ReturnType<typeof makeContext>, userId = "partner-user-1") {
  const partner = await ctx.registerPartner.execute({
    userId,
    type: "TELEGRAM_CHANNEL",
    displayName: "Telegram Valencia",
    contactEmail: "partner@example.com",
  });
  return ctx.approvePartner.execute({ partnerId: partner.id, adminUserId: "admin-1" });
}

describe("Module 61 — Partner approval workflow", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("registers a partner in PENDING status", async () => {
    const partner = await ctx.registerPartner.execute({
      userId: "u1",
      type: "INDIVIDUAL",
      displayName: "Maria",
      contactEmail: "maria@example.com",
    });
    expect(partner.status).toBe("PENDING");
  });

  it("rejects a second partner account for the same user", async () => {
    await ctx.registerPartner.execute({ userId: "u1", type: "INDIVIDUAL", displayName: "Maria", contactEmail: "m@example.com" });
    await expect(
      ctx.registerPartner.execute({ userId: "u1", type: "INDIVIDUAL", displayName: "Maria 2", contactEmail: "m2@example.com" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("approves a pending partner", async () => {
    const partner = await approvedPartner(ctx);
    expect(partner.status).toBe("APPROVED");
    expect(partner.approvedByUserId).toBe("admin-1");
  });

  it("rejects a pending partner with a reason", async () => {
    const partner = await ctx.registerPartner.execute({ userId: "u2", type: "AGENCY", displayName: "Agency X", contactEmail: "a@example.com" });
    const rejected = await ctx.rejectPartner.execute({ partnerId: partner.id, adminUserId: "admin-1", reason: "Incomplete profile" });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectedReason).toBe("Incomplete profile");
  });

  it("cannot approve an already-rejected partner", async () => {
    const partner = await ctx.registerPartner.execute({ userId: "u3", type: "BLOGGER", displayName: "Blog", contactEmail: "b@example.com" });
    await ctx.rejectPartner.execute({ partnerId: partner.id, adminUserId: "admin-1", reason: "no" });
    await expect(ctx.approvePartner.execute({ partnerId: partner.id, adminUserId: "admin-1" })).rejects.toBeInstanceOf(
      InvalidPartnerTransitionError,
    );
  });

  it("suspends then reinstates an approved partner", async () => {
    const partner = await approvedPartner(ctx);
    const suspended = await ctx.suspendPartner.execute({ partnerId: partner.id, adminUserId: "admin-1", reason: "review" });
    expect(suspended.status).toBe("SUSPENDED");
    const reinstated = await ctx.approvePartner.execute({ partnerId: partner.id, adminUserId: "admin-1" });
    expect(reinstated.status).toBe("APPROVED");
  });

  it("bans a partner permanently — cannot be reinstated", async () => {
    const partner = await approvedPartner(ctx);
    const banned = await ctx.banPartner.execute({ partnerId: partner.id, adminUserId: "admin-1", reason: "fraud" });
    expect(banned.status).toBe("BANNED");
    await expect(ctx.approvePartner.execute({ partnerId: partner.id, adminUserId: "admin-1" })).rejects.toBeInstanceOf(
      InvalidPartnerTransitionError,
    );
  });

  it("throws NotFoundError for an unknown partner id", async () => {
    await expect(ctx.approvePartner.execute({ partnerId: "does-not-exist", adminUserId: "admin-1" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Module 61 — GeneratePartnerReferralLinkUseCase (reuses Module 60)", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("generates a referral link owned by the partner's own userId", async () => {
    const partner = await approvedPartner(ctx);
    const code = await ctx.generateLink.execute({ partnerId: partner.id, code: "telegram_valencia" });
    expect(code.code).toBe("telegram_valencia");
    expect(code.ownerUserId).toBe(partner.userId);
  });

  it("refuses to generate a link for a non-APPROVED partner", async () => {
    const partner = await ctx.registerPartner.execute({ userId: "u9", type: "INDIVIDUAL", displayName: "P", contactEmail: "p@example.com" });
    await expect(ctx.generateLink.execute({ partnerId: partner.id, code: "some_code" })).rejects.toBeInstanceOf(PartnerNotActiveError);
  });
});

describe("Module 61 — RecordAffiliateCommissionUseCase (10% of MaestroYa's commission)", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("pays the affiliate exactly 10% of the platform commission for an attributed booking", async () => {
    const partner = await approvedPartner(ctx);
    await ctx.generateLink.execute({ partnerId: partner.id, code: "telegram_valencia" });

    const tracked = await ctx.trackVisit.execute({ visitorId: "visitor-1", referralCode: "telegram_valencia", landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({
      visitorId: "visitor-1",
      type: "COMMISSION_GENERATED",
      referenceId: "commission-abc",
      revenueAmount: 100,
    });

    const affiliateCommission = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-1",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-abc",
      platformCommissionAmount: 100,
    });

    expect(affiliateCommission).not.toBeNull();
    expect(affiliateCommission!.affiliateAmount).toBe(10);
    expect(affiliateCommission!.platformCommissionAmount).toBe(100);
    expect(affiliateCommission!.status).toBe("PENDING");
    expect(affiliateCommission!.partnerId).toBe(partner.id);
    expect(tracked.attribution.lastReferralCode).toBe("telegram_valencia");
  });

  it("is idempotent on the underlying conversion event", async () => {
    const partner = await approvedPartner(ctx);
    await ctx.generateLink.execute({ partnerId: partner.id, code: "code_a" });
    await ctx.trackVisit.execute({ visitorId: "visitor-2", referralCode: "code_a", landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-2", type: "COMMISSION_GENERATED" });

    const first = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-2",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-xyz",
      platformCommissionAmount: 50,
    });
    const second = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-2",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-xyz",
      platformCommissionAmount: 50,
    });

    expect(second!.id).toBe(first!.id);
    expect(await ctx.affiliateCommissions.listForPartner(partner.id)).toHaveLength(1);
  });

  it("returns null for a visitor with no referral attribution", async () => {
    await ctx.trackVisit.execute({ visitorId: "visitor-3", landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-3", type: "COMMISSION_GENERATED" });

    const result = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-3",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-1",
      platformCommissionAmount: 100,
    });
    expect(result).toBeNull();
  });

  it("returns null when the referral code has no partner owner", async () => {
    await ctx.referralCodes.create({ code: "campaign_only", ownerUserId: null });
    await ctx.trackVisit.execute({ visitorId: "visitor-4", referralCode: "campaign_only", landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-4", type: "COMMISSION_GENERATED" });

    const result = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-4",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-2",
      platformCommissionAmount: 100,
    });
    expect(result).toBeNull();
  });

  it("returns null when the referral code's owner is not an APPROVED partner", async () => {
    const partner = await ctx.registerPartner.execute({ userId: "u5", type: "INDIVIDUAL", displayName: "P", contactEmail: "p5@example.com" });
    await ctx.referralCodes.create({ code: "pending_partner_code", ownerUserId: partner.userId });
    await ctx.trackVisit.execute({ visitorId: "visitor-5", referralCode: "pending_partner_code", landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-5", type: "COMMISSION_GENERATED" });

    const result = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-5",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-3",
      platformCommissionAmount: 100,
    });
    expect(result).toBeNull();
  });
});

describe("Module 61 — Commission ledger lifecycle", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  async function pendingCommission(ctx: ReturnType<typeof makeContext>, amount = 100) {
    const partner = await approvedPartner(ctx);
    await ctx.generateLink.execute({ partnerId: partner.id, code: "code_x" });
    await ctx.trackVisit.execute({ visitorId: "visitor-x", referralCode: "code_x", landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-x", type: "COMMISSION_GENERATED" });
    const commission = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-x",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-x",
      platformCommissionAmount: amount,
    });
    return { partner, commission: commission! };
  }

  it("approves a PENDING commission", async () => {
    const { commission } = await pendingCommission(ctx);
    const approved = await ctx.approveAffiliateCommission.execute(commission.id);
    expect(approved.status).toBe("APPROVED");
  });

  it("refuses to approve a non-PENDING commission", async () => {
    const { commission } = await pendingCommission(ctx);
    await ctx.approveAffiliateCommission.execute(commission.id);
    await expect(ctx.approveAffiliateCommission.execute(commission.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("cancels a PENDING commission with a reason", async () => {
    const { commission } = await pendingCommission(ctx);
    const cancelled = await ctx.cancelAffiliateCommission.execute({ id: commission.id, reason: "fraud confirmed" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("fraud confirmed");
  });

  it("expires PENDING commissions past their expiry date", async () => {
    const { commission } = await pendingCommission(ctx);
    const farFuture = new Date(commission.expiresAt.getTime() + 1);
    const expiredCount = await ctx.expireAffiliateCommissions.execute(farFuture);
    expect(expiredCount).toBe(1);
    const updated = await ctx.affiliateCommissions.findById(commission.id);
    expect(updated!.status).toBe("EXPIRED");
  });

  it("never expires an already-APPROVED commission", async () => {
    const { commission } = await pendingCommission(ctx);
    await ctx.approveAffiliateCommission.execute(commission.id);
    const farFuture = new Date(commission.expiresAt.getTime() + 1);
    const expiredCount = await ctx.expireAffiliateCommissions.execute(farFuture);
    expect(expiredCount).toBe(0);
  });

  it("creates a payout once the approved balance reaches the partner's threshold", async () => {
    const { partner, commission } = await pendingCommission(ctx, 1000); // affiliate earns 100
    await ctx.approveAffiliateCommission.execute(commission.id);

    const payout = await ctx.createPayout.execute({
      partnerId: partner.id,
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-01-31"),
    });
    expect(payout.amount).toBe(100);
    expect(payout.status).toBe("PENDING");

    const paidCommission = await ctx.affiliateCommissions.findById(commission.id);
    expect(paidCommission!.status).toBe("PAID");
    expect(paidCommission!.payoutId).toBe(payout.id);
  });

  it("refuses to create a payout below the minimum threshold", async () => {
    const { partner, commission } = await pendingCommission(ctx, 10); // affiliate earns 1, threshold is 50
    await ctx.approveAffiliateCommission.execute(commission.id);
    await expect(
      ctx.createPayout.execute({ partnerId: partner.id, periodStart: new Date(), periodEnd: new Date() }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Module 61 — GetPartnerDashboardStatisticsUseCase", () => {
  it("aggregates visits, registrations, bookings, and affiliate earnings scoped to one partner", async () => {
    const ctx = makeContext();
    const partner = await approvedPartner(ctx);
    await ctx.generateLink.execute({ partnerId: partner.id, code: "code_p", label: "main link" });

    await ctx.trackVisit.execute({ visitorId: "v1", referralCode: "code_p", utmCampaign: "spring", landingPage: "/" });
    await ctx.trackVisit.execute({ visitorId: "v2", referralCode: "code_p", utmCampaign: "spring", landingPage: "/" });
    await ctx.trackVisit.execute({ visitorId: "v3", landingPage: "/" }); // unattributed — must not count

    await ctx.recordConversion.execute({ visitorId: "v1", type: "CLIENT_REGISTRATION" });
    await ctx.recordConversion.execute({ visitorId: "v1", type: "BOOKING_CREATED" });
    await ctx.recordConversion.execute({ visitorId: "v1", type: "BOOKING_COMPLETED" });
    const commissionEvent = await ctx.recordConversion.execute({ visitorId: "v1", type: "COMMISSION_GENERATED" });

    await ctx.recordAffiliateCommission.execute({
      visitorId: "v1",
      conversionEventId: commissionEvent.id,
      platformCommissionRefId: "commission-dash",
      platformCommissionAmount: 200,
    });

    const stats = await ctx.dashboardStats.execute(partner.id);

    expect(stats.visits).toBe(2);
    expect(stats.clicks).toBe(2);
    expect(stats.customerRegistrations).toBe(1);
    expect(stats.bookingsCreated).toBe(1);
    expect(stats.completedJobs).toBe(1);
    expect(stats.platformCommissionGenerated).toBe(200);
    expect(stats.affiliateEarnings.pendingTotal).toBe(20);
    expect(stats.topReferralCodes[0]).toMatchObject({ referralCode: "code_p", visits: 2 });
    expect(stats.topCampaigns[0]).toMatchObject({ campaign: "spring", visits: 2 });
  });

  it("throws NotFoundError for an unknown partner", async () => {
    const ctx = makeContext();
    await expect(ctx.dashboardStats.execute("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Module 61 — DetectPartnerFraudSignalsUseCase", () => {
  it("flags a partner who refers their own userId", async () => {
    const ctx = makeContext();
    const partner = await approvedPartner(ctx, "self-referrer");
    await ctx.generateLink.execute({ partnerId: partner.id, code: "self_code" });

    await ctx.trackVisit.execute({ visitorId: "visitor-self", referralCode: "self_code", landingPage: "/" });
    await ctx.attributions.linkUser("visitor-self", "self-referrer");

    const findings = await ctx.detectFraud.execute(partner.id);
    expect(findings.some((f) => f.type === "SELF_REFERRAL")).toBe(true);
  });

  it("finds nothing for clean partner activity", async () => {
    const ctx = makeContext();
    const partner = await approvedPartner(ctx, "clean-partner");
    await ctx.generateLink.execute({ partnerId: partner.id, code: "clean_code" });
    await ctx.trackVisit.execute({ visitorId: "visitor-clean", referralCode: "clean_code", landingPage: "/" });
    await ctx.attributions.linkUser("visitor-clean", "some-other-user");

    const findings = await ctx.detectFraud.execute(partner.id);
    expect(findings).toHaveLength(0);
  });
});
