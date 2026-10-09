import { describe, expect, it, vi } from "vitest";

import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { GetMyLeadPurchaseEligibilityUseCase } from "@/application/use-cases/lead-purchase-eligibility/get-my-lead-purchase-eligibility.use-case";
import { LeadPurchaseEligibilityPolicy } from "@/application/services/lead-purchase-eligibility-policy";
import { ProfessionalNotVerifiedError } from "@/domain/errors/domain-error";
import type { InitiateLeadPurchaseData, LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import { DuplicateActiveLeadPurchaseError, LeadNotPurchasableError, isActiveLeadPurchaseStatus } from "@/domain/services/lead-purchase";
import { LeadPurchaseNotEligibleError } from "@/domain/services/lead-purchase-eligibility";

import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { eligibilityPolicy, fakeBillingReadiness } from "../../../../../test-utils/lead-purchase-eligibility-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";

/**
 * Module 147 — server-side enforcement in InitiateLeadPurchaseUseCase. The pricing, duplicate-purchase,
 * locking and idempotency behaviour itself is pinned by lead-purchase-use-cases.test.ts (unchanged,
 * eligible professional) and by the real-PostgreSQL tests; here we pin that an ineligible caller never
 * reaches any of it.
 */
const USER = "pro-user";
const LEAD = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-06T10:00:00Z") };

function build(opts: { professional?: Record<string, unknown> | null; policy?: LeadPurchaseEligibilityPolicy } = {}) {
  const rows: LeadPurchaseRecord[] = [];
  const purchases = {
    initiate: vi.fn(async (d: InitiateLeadPurchaseData) => {
      if (rows.some((r) => r.leadId === d.leadId && r.professionalProfileId === d.professionalProfileId && isActiveLeadPurchaseStatus(r.status))) throw new DuplicateActiveLeadPurchaseError();
      const row = pendingPurchaseFromPublication(`p-${rows.length + 1}`, d.leadId, d.professionalProfileId, PUBLICATION);
      rows.push(row);
      return { ...row };
    }),
    findActiveByLeadAndProfessional: vi.fn(async (leadId: string, pro: string) => rows.find((r) => r.leadId === leadId && r.professionalProfileId === pro && isActiveLeadPurchaseStatus(r.status)) ?? null),
  };
  const professionals = {
    findByUserId: vi.fn(async () => (opts.professional === null ? null : { id: "pro-1", status: "ACTIVE", verificationStatus: "VERIFIED", ...opts.professional })),
  };
  const leads = { findById: vi.fn(async () => ({ id: LEAD, serviceRequestId: REQUEST, status: "PUBLISHED", flowVersion: "LEAD_V1", maxBuyers: null, publication: PUBLICATION })) };
  const serviceRequests = { findById: vi.fn(async () => ({ id: REQUEST, status: "PUBLISHED", title: "Fuga", description: "d", location: { city: "Madrid" } })) };
  const previews = {
    findPublishedById: vi.fn(async () => ({ leadId: LEAD, title: "Fuga", description: "d", categoryId: "cat-1", categoryName: "Fontanería", urgency: "HIGH", city: "Madrid", province: "Madrid", latitude: 40.4, longitude: -3.7, customerUserId: "customer-x", createdAt: new Date() })),
  };
  const discovery = { findCandidateById: vi.fn(async () => ({ id: "pro-1", categoryIds: ["cat-1"], latitude: 40.4, longitude: -3.7, serviceRadiusKm: 50 })) };
  const useCase = new InitiateLeadPurchaseUseCase(
    professionals as never,
    discovery as never,
    leads as never,
    serviceRequests as never,
    previews as never,
    purchases as unknown as LeadPurchaseRepository,
    opts.policy ?? eligibilityPolicy(),
  );
  return { useCase, rows, purchases, professionals, leads, serviceRequests, previews, discovery };
}

const untouched = (b: ReturnType<typeof build>) => {
  expect(b.rows).toHaveLength(0);
  expect(b.purchases.initiate).not.toHaveBeenCalled();
  expect(b.leads.findById).not.toHaveBeenCalled(); // no lead probing for an ineligible caller
  expect(b.previews.findPublishedById).not.toHaveBeenCalled();
};

describe("M147 — InitiateLeadPurchaseUseCase enforces the eligibility policy", () => {
  it("eligible professional (M98 VERIFIED + billing ready): unchanged behaviour, a PENDING_PAYMENT purchase is created", async () => {
    const b = build();
    const dto = await b.useCase.execute(USER, LEAD);
    expect(dto).toMatchObject({ leadId: LEAD, status: "PENDING_PAYMENT" });
    expect(b.rows).toHaveLength(1);
  });

  it.each([
    ["missing", { state: "MISSING", isComplete: false, isVerified: false, billingReady: false }, "BILLING_MISSING"],
    ["incomplete", { state: "VERIFIED", isComplete: false, isVerified: true, billingReady: false }, "BILLING_INCOMPLETE"],
    ["unverified (pending review)", { state: "PENDING_REVIEW", isComplete: true, isVerified: false, billingReady: false }, "BILLING_PENDING_REVIEW"],
    ["rejected (needs correction)", { state: "NEEDS_CORRECTION", isComplete: true, isVerified: false, billingReady: false }, "BILLING_NEEDS_CORRECTION"],
    ["unknown state", { state: "FROM_THE_FUTURE", isComplete: true, isVerified: true, billingReady: true }, "BILLING_NOT_READY"],
  ])("%s billing -> LeadPurchaseNotEligibleError(%s), no purchase created, no lead read", async (_name, billing, reason) => {
    const b = build({ policy: eligibilityPolicy(billing) });
    const error = await b.useCase.execute(USER, LEAD).catch((e) => e);
    expect(error).toBeInstanceOf(LeadPurchaseNotEligibleError);
    expect(error).toMatchObject({ code: "LEAD_PURCHASE_NOT_ELIGIBLE", reason, message: "Complete your billing details before purchasing leads." });
    untouched(b);
  });

  it("a missing readiness result fails closed", async () => {
    const b = build({ policy: eligibilityPolicy(null) });
    await expect(b.useCase.execute(USER, LEAD)).rejects.toMatchObject({ code: "LEAD_PURCHASE_NOT_ELIGIBLE", reason: "BILLING_NOT_READY" });
    untouched(b);
  });

  it("a readiness read failure propagates and creates nothing", async () => {
    const b = build({ policy: new LeadPurchaseEligibilityPolicy({ execute: async () => Promise.reject(new Error("db down")) }) });
    await expect(b.useCase.execute(USER, LEAD)).rejects.toThrow("db down");
    untouched(b);
  });

  it("pre-M147 outcomes are preserved: no profile / not ACTIVE -> LeadNotPurchasableError, not VERIFIED -> ProfessionalNotVerifiedError (billing is not even read)", async () => {
    const reader = fakeBillingReadiness();
    const policy = new LeadPurchaseEligibilityPolicy(reader);
    for (const professional of [null, { status: "SUSPENDED" }, { status: "INACTIVE" }]) {
      const b = build({ professional, policy });
      await expect(b.useCase.execute(USER, LEAD)).rejects.toBeInstanceOf(LeadNotPurchasableError);
      untouched(b);
    }
    for (const verificationStatus of ["UNVERIFIED", "PENDING", "REJECTED", "SOMETHING_NEW"]) {
      const b = build({ professional: { verificationStatus }, policy });
      await expect(b.useCase.execute(USER, LEAD)).rejects.toBeInstanceOf(ProfessionalNotVerifiedError);
      untouched(b);
    }
    expect(reader.calls).toEqual([]);
  });

  it("the billing lookup key is the profile resolved from the SESSION user, never a client value", async () => {
    const reader = fakeBillingReadiness();
    const b = build({ professional: { id: "pro-from-session" }, policy: new LeadPurchaseEligibilityPolicy(reader) });
    expect(b.useCase.execute.length).toBe(2); // (userId, leadId) only
    await b.useCase.execute(USER, LEAD);
    expect(b.professionals.findByUserId).toHaveBeenCalledWith(USER);
    expect(reader.calls).toEqual(["pro-from-session"]);
    // Extra forged arguments are ignored: still the same single lookup.
    await (b.useCase.execute as (...args: unknown[]) => Promise<unknown>)(USER, LEAD, { professionalProfileId: "forged", billingReady: true });
    expect(reader.calls).toEqual(["pro-from-session", "pro-from-session"]);
  });

  it("an ineligible professional cannot learn about leads: the error is identical for any lead id, including malformed and unknown ones", async () => {
    const b = build({ policy: eligibilityPolicy({ state: "MISSING", isComplete: false, isVerified: false, billingReady: false }) });
    const results = await Promise.all([LEAD, "33333333-3333-4333-8333-333333333333"].map((id) => b.useCase.execute(USER, id).catch((e) => e)));
    expect(results.map((e) => (e as LeadPurchaseNotEligibleError).reason)).toEqual(["BILLING_MISSING", "BILLING_MISSING"]);
    // Malformed input is rejected before anything is read (unchanged generic error).
    await expect(b.useCase.execute(USER, "not-a-uuid")).rejects.toBeInstanceOf(LeadNotPurchasableError);
  });

  it("duplicate-purchase protection and the idempotent PENDING_PAYMENT replay still work for an eligible professional", async () => {
    const b = build();
    const first = await b.useCase.execute(USER, LEAD);
    const replay = await b.useCase.execute(USER, LEAD);
    expect(replay.purchaseId).toBe(first.purchaseId);
    expect(b.rows).toHaveLength(1);
    b.rows[0]!.status = "CONFIRMED";
    await expect(b.useCase.execute(USER, LEAD)).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
  });

  it("billing becoming unverified after a purchase exists blocks a repeated initiation (it is still an 'initiate'), but creates nothing new", async () => {
    let ready = true;
    const policy = new LeadPurchaseEligibilityPolicy({
      execute: async () => ({ state: ready ? "VERIFIED" : "PENDING_REVIEW", isComplete: true, isVerified: ready, billingReady: ready }),
    });
    const b = build({ policy });
    await b.useCase.execute(USER, LEAD);
    ready = false;
    await expect(b.useCase.execute(USER, LEAD)).rejects.toBeInstanceOf(LeadPurchaseNotEligibleError);
    expect(b.rows).toHaveLength(1);
  });
});

describe("M147 — GetMyLeadPurchaseEligibilityUseCase (display-only guidance)", () => {
  const view = (professional: Record<string, unknown> | null, policy = eligibilityPolicy()) =>
    new GetMyLeadPurchaseEligibilityUseCase({ findByUserId: async () => (professional === null ? null : { id: "pro-1", status: "ACTIVE", verificationStatus: "VERIFIED", ...professional }) } as never, policy);

  it("returns only a flag and a closed reason", async () => {
    expect(await view({}).execute(USER)).toEqual({ eligible: true, reason: null });
    expect(await view({}, eligibilityPolicy({ state: "MISSING", isComplete: false, isVerified: false, billingReady: false })).execute(USER)).toEqual({ eligible: false, reason: "BILLING_MISSING" });
    expect(await view(null).execute(USER)).toEqual({ eligible: false, reason: "NO_PROFESSIONAL_PROFILE" });
    expect(await view({ verificationStatus: "REJECTED" }).execute(USER)).toEqual({ eligible: false, reason: "PROFESSIONAL_NOT_VERIFIED" });
  });

  it("an empty / non-string session id is ineligible without any lookup", async () => {
    const find = vi.fn();
    const useCase = new GetMyLeadPurchaseEligibilityUseCase({ findByUserId: find } as never, eligibilityPolicy());
    expect(await useCase.execute("")).toEqual({ eligible: false, reason: "NO_PROFESSIONAL_PROFILE" });
    expect(await useCase.execute(undefined as never)).toEqual({ eligible: false, reason: "NO_PROFESSIONAL_PROFILE" });
    expect(find).not.toHaveBeenCalled();
  });

  it("the answer never contains billing details even when the readiness result carries a snapshot", async () => {
    const result = await view({}, eligibilityPolicy({ state: "PENDING_REVIEW", isComplete: true, isVerified: false, billingReady: false })).execute(USER);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|taxId|address|snapshot/i);
    expect(Object.keys(result).sort()).toEqual(["eligible", "reason"]);
  });
});
