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
import { ReverseAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/reverse-affiliate-commission.use-case";
import { GetPartnerByUserIdUseCase } from "@/application/use-cases/affiliate/get-partner-by-user-id.use-case";
import type {
  CreateTransferRequest,
  CreateTransferResult,
  ReverseTransferRequest,
  ReverseTransferResult,
  StripeTransferGateway,
} from "@/application/ports/stripe-transfer-gateway";
import { ConflictError, InvalidPartnerTransitionError, NotFoundError, PartnerNotActiveError, StripeTransferError, ValidationError } from "@/domain/errors/domain-error";
import {
  FakeConversionEventRepository,
  FakeMarketingAttributionRepository,
  FakeReferralCodeRepository,
  FakeReferralVisitRepository,
} from "../referral/fakes";
import {
  FakeAffiliateCommissionRepository,
  FakeAffiliateCommissionReversalRepository,
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
/**
 * Module 96 — records every `createTransfer` call it receives so tests can
 * assert the payout destination actually resolved to (only ever) the
 * correct partner's own Stripe account — never a caller-supplied one, and
 * never a different partner's.
 */
class FakeStripeTransferGateway implements StripeTransferGateway {
  calls: CreateTransferRequest[] = [];
  nextTransferId = "tr_fake_1";
  /** Module 96 Financial Fix Pass test hook — when set, the NEXT
   *  `createTransfer` call throws this instead of succeeding (then resets
   *  automatically is NOT done — tests set it back to null explicitly, so
   *  a retry's success is a deliberate test action, not accidental). */
  nextError: Error | null = null;
  /** Module 96 Financial Fix Pass test hook — runs (if set) synchronously
   *  before recording the call, so a test can inspect DB/repository state
   *  exactly at the moment the real Stripe call would have fired (i.e.
   *  after the claim transaction has already committed). */
  beforeCreate: (() => Promise<void>) | null = null;

  async createTransfer(request: CreateTransferRequest): Promise<CreateTransferResult> {
    if (this.beforeCreate) await this.beforeCreate();
    this.calls.push(request);
    if (this.nextError) {
      const error = this.nextError;
      throw error;
    }
    return { stripeTransferId: this.nextTransferId };
  }

  async reverseTransfer(_request: ReverseTransferRequest): Promise<ReverseTransferResult> {
    return { stripeReversalId: "trr_fake_1" };
  }
}

function makeContext() {
  const partners = new FakePartnerRepository();
  const referralCodes = new FakeReferralCodeRepository();
  const visits = new FakeReferralVisitRepository();
  const attributions = new FakeMarketingAttributionRepository();
  const conversions = new FakeConversionEventRepository();
  const affiliateCommissions = new FakeAffiliateCommissionRepository();
  const payouts = new FakePartnerPayoutRepository(affiliateCommissions);
  const fraudFlags = new FakePartnerFraudFlagRepository();
  const affiliateCommissionReversals = new FakeAffiliateCommissionReversalRepository();
  affiliateCommissions.linkReversals(affiliateCommissionReversals);

  return {
    partners,
    referralCodes,
    visits,
    attributions,
    conversions,
    affiliateCommissions,
    payouts,
    fraudFlags,
    affiliateCommissionReversals,
    registerPartner: new RegisterPartnerUseCase(partners),
    approvePartner: new ApprovePartnerUseCase(partners),
    rejectPartner: new RejectPartnerUseCase(partners),
    suspendPartner: new SuspendPartnerUseCase(partners),
    banPartner: new BanPartnerUseCase(partners),
    generateLink: new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(referralCodes)),
    trackVisit: new TrackVisitUseCase(visits, attributions, "test-pepper"),
    recordConversion: new RecordConversionUseCase(conversions, attributions),
    recordAffiliateCommission: new RecordAffiliateCommissionUseCase(attributions, referralCodes, partners, affiliateCommissions, fraudFlags),
    approveAffiliateCommission: new ApproveAffiliateCommissionUseCase(affiliateCommissions),
    cancelAffiliateCommission: new CancelAffiliateCommissionUseCase(affiliateCommissions),
    expireAffiliateCommissions: new ExpireAffiliateCommissionsUseCase(affiliateCommissions),
    createPayout: new CreatePartnerPayoutUseCase(partners, affiliateCommissions, payouts),
    dashboardStats: new GetPartnerDashboardStatisticsUseCase(partners, referralCodes, visits, attributions, conversions, affiliateCommissions),
    detectFraud: new DetectPartnerFraudSignalsUseCase(partners, referralCodes, visits, attributions, conversions, fraudFlags),
    reverseAffiliateCommission: new ReverseAffiliateCommissionUseCase(affiliateCommissions, affiliateCommissionReversals),
    getPartnerByUserId: new GetPartnerByUserIdUseCase(partners),
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

  it("Module 96 — hard-blocks a self-referral: never creates a payable commission, but records a fraud flag for admin auditability", async () => {
    const partner = await approvedPartner(ctx, "self-referring-partner");
    await ctx.generateLink.execute({ partnerId: partner.id, code: "own_code" });
    await ctx.trackVisit.execute({ visitorId: "visitor-self", referralCode: "own_code", landingPage: "/" });
    // The partner registers/logs an account using their own referral link —
    // the attribution's linked userId is the partner's own userId.
    await ctx.attributions.linkUser("visitor-self", partner.userId);
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-self", type: "COMMISSION_GENERATED" });

    const result = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-self",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-self",
      platformCommissionAmount: 100,
    });

    expect(result).toBeNull();
    expect(await ctx.affiliateCommissions.listForPartner(partner.id)).toHaveLength(0);

    const flags = await ctx.fraudFlags.listForPartner(partner.id);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.type).toBe("SELF_REFERRAL");
    expect(flags[0]!.status).toBe("OPEN");
  });

  it("Module 96 — does NOT block a normal (non-self) referral — the hard block is specific to the partner's own userId", async () => {
    const partner = await approvedPartner(ctx, "normal-partner");
    await ctx.generateLink.execute({ partnerId: partner.id, code: "normal_code" });
    await ctx.trackVisit.execute({ visitorId: "visitor-normal", referralCode: "normal_code", landingPage: "/" });
    await ctx.attributions.linkUser("visitor-normal", "a-different-customer");
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-normal", type: "COMMISSION_GENERATED" });

    const result = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-normal",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-normal",
      platformCommissionAmount: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.affiliateAmount).toBe(10);
    expect(await ctx.fraudFlags.listForPartner(partner.id)).toHaveLength(0);
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
    // Module 96: a MANUAL-method partner's payout settles immediately —
    // there is no Stripe transfer to wait on, so the batch is recorded
    // and marked PAID in the same call (see STRIPE-method coverage below).
    expect(payout.status).toBe("PAID");

    const paidCommission = await ctx.affiliateCommissions.findById(commission.id);
    expect(paidCommission!.status).toBe("PAID");
    expect(paidCommission!.payoutId).toBe(payout.id);
  });

  it("refuses to start a second payout while one is already PENDING/PROCESSING", async () => {
    const { partner, commission } = await pendingCommission(ctx, 1000);
    await ctx.approveAffiliateCommission.execute(commission.id);
    // Seed an in-flight payout directly (bypassing createPayout, which for
    // a MANUAL partner always settles synchronously) so the guard is
    // exercised against a genuinely non-terminal row, exactly the shape a
    // STRIPE-method payout sits in between "PROCESSING" and "PAID"/"FAILED".
    const inFlight = await ctx.payouts.create({
      partnerId: partner.id,
      amount: 1,
      method: "MANUAL",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-01-31"),
    });
    expect(inFlight.status).toBe("PENDING");

    await expect(
      ctx.createPayout.execute({ partnerId: partner.id, periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to create a payout below the minimum threshold", async () => {
    const { partner, commission } = await pendingCommission(ctx, 10); // affiliate earns 1, threshold is 50
    await ctx.approveAffiliateCommission.execute(commission.id);
    await expect(
      ctx.createPayout.execute({ partnerId: partner.id, periodStart: new Date(), periodEnd: new Date() }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Module 96 — CreatePartnerPayoutUseCase (Stripe Connect transfer wiring)", () => {
  let ctx: ReturnType<typeof makeContext>;
  let gateway: FakeStripeTransferGateway;
  let createStripePayout: CreatePartnerPayoutUseCase;

  beforeEach(() => {
    ctx = makeContext();
    gateway = new FakeStripeTransferGateway();
    createStripePayout = new CreatePartnerPayoutUseCase(ctx.partners, ctx.affiliateCommissions, ctx.payouts, gateway);
  });

  async function approvedStripePartner(ctx: ReturnType<typeof makeContext>, userId: string, stripeConnectAccountId: string | null) {
    const partner = await ctx.registerPartner.execute({
      userId,
      type: "TELEGRAM_CHANNEL",
      displayName: `Partner ${userId}`,
      contactEmail: `${userId}@example.com`,
      payoutMethod: "STRIPE",
      payoutDetails: stripeConnectAccountId ? { stripeConnectAccountId } : null,
    });
    return ctx.approvePartner.execute({ partnerId: partner.id, adminUserId: "admin-1" });
  }

  async function approvedCommissionFor(ctx: ReturnType<typeof makeContext>, partnerId: string, code: string, amount: number) {
    await ctx.generateLink.execute({ partnerId, code });
    await ctx.trackVisit.execute({ visitorId: `visitor-${code}`, referralCode: code, landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({ visitorId: `visitor-${code}`, type: "COMMISSION_GENERATED" });
    const commission = await ctx.recordAffiliateCommission.execute({
      visitorId: `visitor-${code}`,
      conversionEventId: conversion.id,
      platformCommissionRefId: `commission-${code}`,
      platformCommissionAmount: amount,
    });
    await ctx.approveAffiliateCommission.execute(commission!.id);
    return commission!;
  }

  it("executes a real Stripe transfer to the partner's own connected account and marks the payout PAID", async () => {
    const partner = await approvedStripePartner(ctx, "stripe-partner-a", "acct_partner_a");
    await approvedCommissionFor(ctx, partner.id, "code_a", 1000); // affiliate earns 100

    const payout = await createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });

    expect(payout.status).toBe("PAID");
    expect(payout.reference).toBe(gateway.nextTransferId);
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]!.destinationStripeAccountId).toBe("acct_partner_a");
    expect(gateway.calls[0]!.amount).toBe(100);
  });

  it("never redirects partner A's payout to partner B's Stripe account", async () => {
    const partnerA = await approvedStripePartner(ctx, "stripe-partner-a2", "acct_partner_a2");
    const partnerB = await approvedStripePartner(ctx, "stripe-partner-b2", "acct_partner_b2");
    await approvedCommissionFor(ctx, partnerA.id, "code_a2", 1000);
    await approvedCommissionFor(ctx, partnerB.id, "code_b2", 1000);

    // The use case's `execute` input carries only a partnerId — there is
    // no destination-account parameter anywhere on it for a caller to
    // (accidentally or maliciously) supply, so this test asserts the
    // resolved destination end-to-end: paying out A must never touch B's
    // account, and vice versa.
    const payoutA = await createStripePayout.execute({ partnerId: partnerA.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
    const payoutB = await createStripePayout.execute({ partnerId: partnerB.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });

    expect(gateway.calls).toHaveLength(2);
    const callForA = gateway.calls.find((c) => c.metadata.payoutId === payoutA.id);
    const callForB = gateway.calls.find((c) => c.metadata.payoutId === payoutB.id);
    expect(callForA!.destinationStripeAccountId).toBe("acct_partner_a2");
    expect(callForB!.destinationStripeAccountId).toBe("acct_partner_b2");
  });

  it("fails the payout (not the transfer) when a STRIPE-method partner has no connected account on file", async () => {
    const partner = await approvedStripePartner(ctx, "stripe-partner-c", null);
    await approvedCommissionFor(ctx, partner.id, "code_c", 1000);

    await expect(
      createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(gateway.calls).toHaveLength(0);

    const payouts = await ctx.payouts.listForPartner(partner.id);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]!.status).toBe("FAILED");
  });

  it("rejects a duplicate payout attempt for a STRIPE-method partner while one is in flight", async () => {
    const partner = await approvedStripePartner(ctx, "stripe-partner-d", "acct_partner_d");
    await approvedCommissionFor(ctx, partner.id, "code_d", 1000);
    await ctx.payouts.create({ partnerId: partner.id, amount: 1, method: "STRIPE", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });

    await expect(
      createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(gateway.calls).toHaveLength(0);
  });

  it("Module 96 Financial Fix Pass — a commission is claimed (payoutId set) as soon as the payout is created, BEFORE the Stripe transfer runs", async () => {
    const partner = await approvedStripePartner(ctx, "stripe-partner-e", "acct_partner_e");
    const commission = await approvedCommissionFor(ctx, partner.id, "code_e", 1000);

    gateway.beforeCreate = async () => {
      // Inspect claim state mid-flight, before the transfer "completes".
      const midFlight = await ctx.affiliateCommissions.findById(commission.id);
      expect(midFlight?.payoutId).not.toBeNull();
      expect(midFlight?.status).toBe("APPROVED"); // not yet PAID — only claimed
    };

    await createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
  });

  it("Module 96 Financial Fix Pass — a failed Stripe transfer releases the claimed commission so a retry attempt can select it again", async () => {
    const partner = await approvedStripePartner(ctx, "stripe-partner-f", "acct_partner_f");
    const commission = await approvedCommissionFor(ctx, partner.id, "code_f", 1000);
    gateway.nextError = new StripeTransferError("INSUFFICIENT_BALANCE", "Insufficient balance.", true);

    await expect(
      createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") }),
    ).rejects.toBeInstanceOf(StripeTransferError);

    const released = await ctx.affiliateCommissions.findById(commission.id);
    expect(released?.payoutId).toBeNull();
    expect(released?.status).toBe("APPROVED"); // still payable — never silently unpaid or lost

    // A retry (the same partner, a genuinely new attempt) must now be
    // able to select this commission again — it was never permanently
    // stranded under the dead payout.
    gateway.nextError = null;
    const retried = await createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") });
    expect(retried.status).toBe("PAID");
    const finalCommission = await ctx.affiliateCommissions.findById(commission.id);
    expect(finalCommission?.status).toBe("PAID");
    expect(finalCommission?.payoutId).toBe(retried.id);
  });

  it("Module 96 Financial Fix Pass — a retried payout after a prior failure gets its OWN new Stripe idempotency key, never reusing the dead payout's id", async () => {
    const partner = await approvedStripePartner(ctx, "stripe-partner-g", "acct_partner_g");
    await approvedCommissionFor(ctx, partner.id, "code_g", 1000);
    gateway.nextError = new StripeTransferError("NETWORK", "Connection reset.", true);

    await expect(
      createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") }),
    ).rejects.toBeInstanceOf(StripeTransferError);
    const firstAttemptPayoutId = gateway.calls[0]!.metadata.payoutId;

    gateway.nextError = null;
    const retried = await createStripePayout.execute({ partnerId: partner.id, periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") });

    expect(retried.id).not.toBe(firstAttemptPayoutId);
    expect(gateway.calls[1]!.idempotencyKey).toBe(`partner-payout:${retried.id}`);
    expect(gateway.calls[1]!.idempotencyKey).not.toBe(gateway.calls[0]!.idempotencyKey);
  });
});

describe("Module 96 — ReverseAffiliateCommissionUseCase (refund/chargeback reversal)", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  async function pendingCommission(ctx: ReturnType<typeof makeContext>, amount = 100) {
    const partner = await approvedPartner(ctx);
    await ctx.generateLink.execute({ partnerId: partner.id, code: "code_r" });
    await ctx.trackVisit.execute({ visitorId: "visitor-r", referralCode: "code_r", landingPage: "/" });
    const conversion = await ctx.recordConversion.execute({ visitorId: "visitor-r", type: "COMMISSION_GENERATED" });
    const commission = await ctx.recordAffiliateCommission.execute({
      visitorId: "visitor-r",
      conversionEventId: conversion.id,
      platformCommissionRefId: "commission-r",
      platformCommissionAmount: amount,
    });
    return { partner, commission: commission! };
  }

  it("a full refund fully reverses the commission — net balance goes to exactly 0, status becomes REVERSED", async () => {
    const { commission } = await pendingCommission(ctx, 1000); // affiliateAmount = 100

    const result = await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-1",
      refundedAmount: 1000,
      paymentAmount: 1000,
      isFullRefund: true,
      reason: "Full refund.",
    });

    expect(result!.reversedAmount).toBe(100);
    expect(result!.status).toBe("REVERSED");
    expect(result!.affiliateAmount).toBe(100); // original figure never mutated
  });

  it("a partial refund proportionally reverses the commission — the original row is never mutated, only reversedAmount", async () => {
    const { commission } = await pendingCommission(ctx, 1000); // affiliateAmount = 100

    const result = await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-2",
      refundedAmount: 300,
      paymentAmount: 1000,
      isFullRefund: false,
      reason: "Partial refund.",
    });

    expect(result!.reversedAmount).toBe(30);
    expect(result!.status).toBe("PENDING"); // not fully reversed — status unchanged
    expect(result!.affiliateAmount).toBe(100);
  });

  it("is idempotent under a duplicate/redelivered refund webhook — the same financialAdjustmentId never reverses twice", async () => {
    const { commission } = await pendingCommission(ctx, 1000);

    const first = await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-3",
      refundedAmount: 300,
      paymentAmount: 1000,
      isFullRefund: false,
      reason: "Partial refund.",
    });
    const second = await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-3",
      refundedAmount: 300,
      paymentAmount: 1000,
      isFullRefund: false,
      reason: "Partial refund (redelivered).",
    });

    expect(second!.reversedAmount).toBe(first!.reversedAmount);
    expect(second!.reversedAmount).toBe(30); // not 60 — never double-reversed
    expect(await ctx.affiliateCommissionReversals.listForAffiliateCommission(commission.id)).toHaveLength(1);
  });

  it("a sequence of partial refunds followed by a final full refund never over-reverses", async () => {
    const { commission } = await pendingCommission(ctx, 1000); // affiliateAmount = 100

    await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-4a",
      refundedAmount: 400,
      paymentAmount: 1000,
      isFullRefund: false,
      reason: "First partial refund.",
    }); // reverses 40

    const final = await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-4b",
      refundedAmount: 1000,
      paymentAmount: 1000,
      isFullRefund: true,
      reason: "Remainder refunded.",
    });

    expect(final!.reversedAmount).toBe(100); // 40 + 60, never 40 + 100
    expect(final!.status).toBe("REVERSED");
  });

  it("a commission already PAID stays PAID after a full reversal — the clawback is recorded, not silently unpaid", async () => {
    const { partner, commission } = await pendingCommission(ctx, 1000);
    await ctx.approveAffiliateCommission.execute(commission.id);
    await ctx.createPayout.execute({ partnerId: partner.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
    const paid = await ctx.affiliateCommissions.findById(commission.id);
    expect(paid!.status).toBe("PAID");

    const result = await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-5",
      refundedAmount: 1000,
      paymentAmount: 1000,
      isFullRefund: true,
      reason: "Chargeback after payout.",
    });

    expect(result!.status).toBe("PAID"); // never silently reverted
    expect(result!.reversedAmount).toBe(100); // clawback still recorded for reconciliation
  });

  it("a CANCELLED commission has nothing to reverse — returns it unchanged", async () => {
    const { commission } = await pendingCommission(ctx, 1000);
    await ctx.cancelAffiliateCommission.execute({ id: commission.id, reason: "fraud confirmed" });

    const result = await ctx.reverseAffiliateCommission.execute({
      affiliateCommissionId: commission.id,
      financialAdjustmentId: "adjustment-6",
      refundedAmount: 1000,
      paymentAmount: 1000,
      isFullRefund: true,
      reason: "N/A.",
    });

    expect(result!.reversedAmount).toBe(0);
    expect(result!.status).toBe("CANCELLED");
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

  it("Module 96 — isolation: partner A's dashboard never includes partner B's clicks/earnings, and vice versa", async () => {
    const ctx = makeContext();
    const partnerA = await approvedPartner(ctx, "partner-a-user");
    const partnerB = await approvedPartner(ctx, "partner-b-user");
    await ctx.generateLink.execute({ partnerId: partnerA.id, code: "code_a_dash" });
    await ctx.generateLink.execute({ partnerId: partnerB.id, code: "code_b_dash" });

    await ctx.trackVisit.execute({ visitorId: "va1", referralCode: "code_a_dash", landingPage: "/" });
    await ctx.trackVisit.execute({ visitorId: "va2", referralCode: "code_a_dash", landingPage: "/" });
    await ctx.trackVisit.execute({ visitorId: "vb1", referralCode: "code_b_dash", landingPage: "/" });

    const statsA = await ctx.dashboardStats.execute(partnerA.id);
    const statsB = await ctx.dashboardStats.execute(partnerB.id);

    expect(statsA.visits).toBe(2);
    expect(statsB.visits).toBe(1);
    expect(statsA.topReferralCodes.some((r) => r.referralCode === "code_b_dash")).toBe(false);
    expect(statsB.topReferralCodes.some((r) => r.referralCode === "code_a_dash")).toBe(false);
  });
});

describe("Module 96 — GetPartnerByUserIdUseCase (dashboard route isolation)", () => {
  it("resolves each user's own partner account only — never another user's", async () => {
    const ctx = makeContext();
    const partnerA = await approvedPartner(ctx, "user-a");
    const partnerB = await approvedPartner(ctx, "user-b");

    const resolvedForA = await ctx.getPartnerByUserId.execute("user-a");
    const resolvedForB = await ctx.getPartnerByUserId.execute("user-b");

    expect(resolvedForA!.id).toBe(partnerA.id);
    expect(resolvedForB!.id).toBe(partnerB.id);
    expect(resolvedForA!.id).not.toBe(resolvedForB!.id);
  });

  it("returns null for a user with no partner account — never someone else's, never a guess", async () => {
    const ctx = makeContext();
    await approvedPartner(ctx, "user-a");

    const resolved = await ctx.getPartnerByUserId.execute("ordinary-customer");
    expect(resolved).toBeNull();
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
