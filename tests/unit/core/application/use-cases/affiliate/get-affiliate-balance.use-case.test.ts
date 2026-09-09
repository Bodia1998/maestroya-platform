import { describe, expect, it, vi } from "vitest";

import { GetAffiliateBalanceUseCase } from "@/application/use-cases/affiliate/get-affiliate-balance.use-case";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository, AffiliateEarningsTotals } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 100 — Affiliate Accumulated Balance & €50 Payout: unit tests for
 * `GetAffiliateBalanceUseCase` — the partner-facing balance/eligibility
 * read model.
 */
function fakePartner(overrides: Partial<PartnerRecord> = {}): PartnerRecord {
  return {
    id: "partner-1",
    userId: "user-1",
    type: "TELEGRAM_CHANNEL",
    status: "APPROVED",
    displayName: "Partner One",
    contactEmail: "partner1@example.com",
    payoutMethod: "MANUAL",
    payoutDetails: null,
    minimumPayoutThreshold: 50,
    notes: null,
    approvedAt: new Date(),
    approvedByUserId: "admin-1",
    rejectedAt: null,
    rejectedReason: null,
    suspendedAt: null,
    suspendedReason: null,
    bannedAt: null,
    bannedReason: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as PartnerRecord;
}

function fakeCommission(overrides: Partial<AffiliateCommissionRecord> = {}): AffiliateCommissionRecord {
  return {
    id: "c1",
    partnerId: "partner-1",
    referralCode: "CODE1",
    conversionEventId: "evt-1",
    platformCommissionRefId: "comm-1",
    platformCommissionAmount: 100,
    attributableCostAmount: 0,
    profitBaseAmount: 100,
    affiliateRateBps: 1000,
    affiliateAmount: 20,
    reversedAmount: 0,
    costFinalizationFailedAt: null,
    status: "APPROVED",
    approvedAt: new Date(),
    cancelledAt: null,
    cancelReason: null,
    expiresAt: new Date(),
    expiredAt: null,
    paidAt: null,
    payoutId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AffiliateCommissionRecord;
}

function fakeRepos(opts: {
  partner?: PartnerRecord | null;
  totals?: AffiliateEarningsTotals;
  unclaimedApproved?: AffiliateCommissionRecord[];
  allApproved?: AffiliateCommissionRecord[];
}) {
  const partners = {
    findById: vi.fn().mockResolvedValue(opts.partner === undefined ? fakePartner() : opts.partner),
  } as unknown as PartnerRepository;

  const affiliateCommissions = {
    totalsForPartner: vi.fn().mockResolvedValue(opts.totals ?? { pendingTotal: 0, approvedTotal: 0, paidTotal: 0 }),
    listApprovedForPartner: vi.fn().mockResolvedValue(opts.unclaimedApproved ?? []),
    listForPartner: vi.fn().mockResolvedValue(opts.allApproved ?? opts.unclaimedApproved ?? []),
  } as unknown as AffiliateCommissionRepository;

  return { partners, affiliateCommissions };
}

describe("GetAffiliateBalanceUseCase (Module 100)", () => {
  it("throws NotFoundError for an unknown partner", async () => {
    const { partners, affiliateCommissions } = fakeRepos({ partner: null });
    const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
    await expect(useCase.execute("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("accumulates available balance across multiple unclaimed approved commissions", async () => {
    const commissions = [fakeCommission({ id: "c1", affiliateAmount: 20 }), fakeCommission({ id: "c2", affiliateAmount: 15 }), fakeCommission({ id: "c3", affiliateAmount: 15 })];
    const { partners, affiliateCommissions } = fakeRepos({ unclaimedApproved: commissions, allApproved: commissions });
    const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
    const summary = await useCase.execute("partner-1");
    expect(summary.availableBalance).toBe(50);
    expect(summary.isEligibleForPayout).toBe(true);
    expect(summary.amountUntilEligible).toBe(0);
  });

  it("is not eligible one cent below the threshold", async () => {
    const commissions = [fakeCommission({ id: "c1", affiliateAmount: 49.99 })];
    const { partners, affiliateCommissions } = fakeRepos({ unclaimedApproved: commissions, allApproved: commissions });
    const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
    const summary = await useCase.execute("partner-1");
    expect(summary.availableBalance).toBe(49.99);
    expect(summary.isEligibleForPayout).toBe(false);
    expect(summary.amountUntilEligible).toBe(0.01);
  });

  it("is eligible exactly at the threshold and one cent above it", async () => {
    for (const amount of [50, 50.01]) {
      const commissions = [fakeCommission({ id: "c1", affiliateAmount: amount })];
      const { partners, affiliateCommissions } = fakeRepos({ unclaimedApproved: commissions, allApproved: commissions });
      const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
      const summary = await useCase.execute("partner-1");
      expect(summary.isEligibleForPayout).toBe(true);
    }
  });

  it("nets a partially-reversed commission out of the available balance", async () => {
    const commissions = [fakeCommission({ id: "c1", affiliateAmount: 60, reversedAmount: 20 })];
    const { partners, affiliateCommissions } = fakeRepos({ unclaimedApproved: commissions, allApproved: commissions });
    const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
    const summary = await useCase.execute("partner-1");
    expect(summary.availableBalance).toBe(40);
  });

  it("separates money already claimed by an in-flight payout as reservedForPayout, excluded from availableBalance", async () => {
    // c1 is claimed by an in-flight payout (excluded from listApprovedForPartner,
    // the "unclaimed" set) but still shows up in listForPartner({status:"APPROVED"})
    // (the "all approved" set) — this is exactly how a partner's balance
    // must behave while a payout is PROCESSING: the claimed amount is
    // neither available for a second payout nor silently dropped from view.
    const claimed = fakeCommission({ id: "c1", affiliateAmount: 30, payoutId: "payout-in-flight" });
    const unclaimed = fakeCommission({ id: "c2", affiliateAmount: 10 });
    const { partners, affiliateCommissions } = fakeRepos({
      unclaimedApproved: [unclaimed],
      allApproved: [claimed, unclaimed],
    });
    const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
    const summary = await useCase.execute("partner-1");
    expect(summary.availableBalance).toBe(10);
    expect(summary.reservedForPayout).toBe(30);
    // Not eligible for a NEW payout — the €10 available is below threshold,
    // even though total approved (€40) is not.
    expect(summary.isEligibleForPayout).toBe(false);
  });

  it("respects a per-partner custom minimumPayoutThreshold", async () => {
    const commissions = [fakeCommission({ id: "c1", affiliateAmount: 30 })];
    const { partners, affiliateCommissions } = fakeRepos({
      partner: fakePartner({ minimumPayoutThreshold: 25 }),
      unclaimedApproved: commissions,
      allApproved: commissions,
    });
    const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
    const summary = await useCase.execute("partner-1");
    expect(summary.isEligibleForPayout).toBe(true);
    expect(summary.minimumPayoutThreshold).toBe(25);
  });

  it("never reports a negative available balance or reservedForPayout", async () => {
    const { partners, affiliateCommissions } = fakeRepos({ unclaimedApproved: [], allApproved: [] });
    const useCase = new GetAffiliateBalanceUseCase(partners, affiliateCommissions);
    const summary = await useCase.execute("partner-1");
    expect(summary.availableBalance).toBe(0);
    expect(summary.reservedForPayout).toBe(0);
    expect(summary.isEligibleForPayout).toBe(false);
  });
});
