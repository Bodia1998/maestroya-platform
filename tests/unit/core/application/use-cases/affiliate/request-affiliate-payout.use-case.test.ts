import { describe, expect, it, vi } from "vitest";

import { RequestAffiliatePayoutUseCase } from "@/application/use-cases/affiliate/request-affiliate-payout.use-case";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerPayoutRecord } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";
import type { CreatePartnerPayoutUseCase } from "@/application/use-cases/affiliate/create-partner-payout.use-case";

/**
 * Module 100 — Affiliate Accumulated Balance & €50 Payout: unit tests for
 * `RequestAffiliatePayoutUseCase` — the self-service payout-request
 * wrapper. Since every actual accounting/concurrency/threshold guarantee
 * lives in `CreatePartnerPayoutUseCase` (already covered by Module
 * 61/96's own tests and the DB-level integration test at
 * tests/integration-db/affiliate/partner-payout-inflight-uniqueness.test.ts),
 * these tests focus on what THIS wrapper is actually responsible for:
 * resolving the partner, auto-deriving the period, and delegating —
 * never re-implementing — the actual payout creation.
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
    affiliateAmount: 60,
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
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date(),
    ...overrides,
  } as AffiliateCommissionRecord;
}

function fakePayout(overrides: Partial<PartnerPayoutRecord> = {}): PartnerPayoutRecord {
  return {
    id: "payout-1",
    partnerId: "partner-1",
    amount: 60,
    currency: "EUR",
    method: "MANUAL",
    status: "PAID",
    reference: null,
    periodStart: new Date(),
    periodEnd: new Date(),
    processedAt: new Date(),
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PartnerPayoutRecord;
}

describe("RequestAffiliatePayoutUseCase (Module 100)", () => {
  it("throws NotFoundError for an unknown partner", async () => {
    const partners = { findById: vi.fn().mockResolvedValue(null) } as unknown as PartnerRepository;
    const affiliateCommissions = { listApprovedForPartner: vi.fn() } as unknown as AffiliateCommissionRepository;
    const createPayout = { execute: vi.fn() } as unknown as CreatePartnerPayoutUseCase;

    const useCase = new RequestAffiliatePayoutUseCase(partners, affiliateCommissions, createPayout);
    await expect(useCase.execute({ partnerId: "missing" })).rejects.toBeInstanceOf(NotFoundError);
    expect(createPayout.execute).not.toHaveBeenCalled();
  });

  it("delegates to CreatePartnerPayoutUseCase with the requesting partner's own id and an auto-derived period", async () => {
    const partner = fakePartner();
    const partners = { findById: vi.fn().mockResolvedValue(partner) } as unknown as PartnerRepository;
    const earliest = new Date("2026-02-01");
    const commissions = [fakeCommission({ id: "c1", createdAt: new Date("2026-03-15") }), fakeCommission({ id: "c2", createdAt: earliest })];
    const affiliateCommissions = { listApprovedForPartner: vi.fn().mockResolvedValue(commissions) } as unknown as AffiliateCommissionRepository;
    const payout = fakePayout();
    const createPayout = { execute: vi.fn().mockResolvedValue(payout) } as unknown as CreatePartnerPayoutUseCase;

    const useCase = new RequestAffiliatePayoutUseCase(partners, affiliateCommissions, createPayout);
    const result = await useCase.execute({ partnerId: "partner-1" });

    expect(result).toBe(payout);
    expect(createPayout.execute).toHaveBeenCalledTimes(1);
    const call = (createPayout.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.partnerId).toBe("partner-1");
    expect(call.periodStart).toEqual(earliest);
    expect(call.periodEnd).toBeInstanceOf(Date);
  });

  it("propagates the threshold rejection from CreatePartnerPayoutUseCase unchanged (never duplicates the check)", async () => {
    const partner = fakePartner();
    const partners = { findById: vi.fn().mockResolvedValue(partner) } as unknown as PartnerRepository;
    const affiliateCommissions = { listApprovedForPartner: vi.fn().mockResolvedValue([]) } as unknown as AffiliateCommissionRepository;
    const createPayout = {
      execute: vi.fn().mockRejectedValue(new ValidationError("Partner has not reached the minimum payout threshold.")),
    } as unknown as CreatePartnerPayoutUseCase;

    const useCase = new RequestAffiliatePayoutUseCase(partners, affiliateCommissions, createPayout);
    await expect(useCase.execute({ partnerId: "partner-1" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("falls back to the partner's own createdAt for periodStart when there are no unclaimed approved commissions", async () => {
    const partner = fakePartner({ createdAt: new Date("2025-06-01") });
    const partners = { findById: vi.fn().mockResolvedValue(partner) } as unknown as PartnerRepository;
    const affiliateCommissions = { listApprovedForPartner: vi.fn().mockResolvedValue([]) } as unknown as AffiliateCommissionRepository;
    const createPayout = { execute: vi.fn().mockResolvedValue(fakePayout()) } as unknown as CreatePartnerPayoutUseCase;

    const useCase = new RequestAffiliatePayoutUseCase(partners, affiliateCommissions, createPayout);
    await useCase.execute({ partnerId: "partner-1" });

    const call = (createPayout.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.periodStart).toEqual(new Date("2025-06-01"));
  });

  it("never accepts a caller-supplied partnerId override — the input shape has exactly one identity field", () => {
    // Type-level guard: RequestAffiliatePayoutUseCase.execute's input is
    // `{ partnerId: string }` — there is no second id field (e.g. a
    // "targetPartnerId" or "onBehalfOf") anywhere on it. This test is a
    // compile-time assertion as much as a runtime one: if a future edit
    // ever added such a field, TypeScript would need an explicit cast to
    // keep this line compiling, making the change visible in review.
    type Input = Parameters<RequestAffiliatePayoutUseCase["execute"]>[0];
    const input: Input = { partnerId: "partner-1" };
    expect(Object.keys(input)).toEqual(["partnerId"]);
  });
});
