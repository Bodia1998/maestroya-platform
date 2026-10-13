import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_LEAD_FEE_REWARD_POLICY_CONFIG,
  calculateLeadFeeRewardAmount,
  calculateLeadFeeRewardReversalAmount,
  computeLeadFeeRewardReleaseAt,
  evaluateLeadFeeRewardEligibility,
  getActiveLeadFeeRewardPolicy,
  resolveLeadFeeRewardPolicy,
  type LeadFeeRewardAttribution,
  type LeadFeeRewardEligibilityInput,
  type LeadFeeRewardSourceEntry,
} from "@/domain/services/lead-fee-affiliate-reward";

/**
 * Module 162. TEST-ONLY FIXTURE: the numbers below (1000 bps, 30 days, ...) are arbitrary values used to
 * exercise the arithmetic. They are NOT an approved policy (D18 is open) and are never shipped.
 */
const FIXTURE_POLICY_RAW = {
  version: "test-fixture-v1",
  approvalReference: "TEST-ONLY",
  referredParty: "PROFESSIONAL",
  basis: "NET_LEAD_FEE",
  rateBps: 1000,
  rounding: "HALF_UP",
  holdDays: 30,
};

const approved = resolveLeadFeeRewardPolicy(FIXTURE_POLICY_RAW);

const entry = (o: Partial<LeadFeeRewardSourceEntry> = {}): LeadFeeRewardSourceEntry => ({
  id: "ledger-1",
  entryType: "LEAD_FEE_PAYMENT_SUCCEEDED",
  leadPurchaseId: "purchase-1",
  netFeeAmount: "18.00",
  currency: "EUR",
  paymentConfirmedAt: new Date("2026-10-01T10:00:00.000Z"),
  ...o,
});

const attribution = (o: Partial<LeadFeeRewardAttribution> = {}): LeadFeeRewardAttribution => ({
  partnerId: "partner-1",
  partnerUserId: "user-partner",
  partnerApproved: true,
  referralCodeActive: true,
  referredUserId: "user-professional",
  referredParty: "PROFESSIONAL",
  ...o,
});

const input = (o: Partial<LeadFeeRewardEligibilityInput> = {}): LeadFeeRewardEligibilityInput => ({
  policy: approved,
  sourceEntry: entry(),
  purchaseStatus: "CONFIRMED",
  attribution: attribution(),
  ...o,
});

describe("M162 — fail-closed policy", () => {
  it("ships NO active policy and therefore never approves one", () => {
    expect(ACTIVE_LEAD_FEE_REWARD_POLICY_CONFIG).toBeNull();
    expect(getActiveLeadFeeRewardPolicy()).toEqual({ status: "UNAPPROVED", reason: "POLICY_ABSENT" });
  });

  it("the shipped (unapproved) policy makes every input ineligible, without looking at anything else", () => {
    const r = evaluateLeadFeeRewardEligibility(input({ policy: getActiveLeadFeeRewardPolicy() }));
    expect(r).toEqual({ eligible: false, reason: "POLICY_UNAPPROVED", policyRejection: "POLICY_ABSENT" });
  });

  it.each([
    ["undefined", undefined, "POLICY_ABSENT"],
    ["string", "10%", "POLICY_MALFORMED"],
    ["array", [], "POLICY_MALFORMED"],
    ["no version", { ...FIXTURE_POLICY_RAW, version: " " }, "POLICY_MALFORMED"],
    ["no approval reference", { ...FIXTURE_POLICY_RAW, approvalReference: "" }, "APPROVAL_REFERENCE_MISSING"],
    ["unknown referred party", { ...FIXTURE_POLICY_RAW, referredParty: "BOTH" }, "REFERRED_PARTY_UNSUPPORTED"],
    ["missing referred party", { ...FIXTURE_POLICY_RAW, referredParty: undefined }, "REFERRED_PARTY_UNSUPPORTED"],
    ["Stripe-net basis is unsupported", { ...FIXTURE_POLICY_RAW, basis: "NET_AFTER_STRIPE_FEE" }, "BASIS_UNSUPPORTED"],
    ["job value basis", { ...FIXTURE_POLICY_RAW, basis: "JOB_VALUE" }, "BASIS_UNSUPPORTED"],
    ["rate 0", { ...FIXTURE_POLICY_RAW, rateBps: 0 }, "RATE_INVALID"],
    ["rate > 100%", { ...FIXTURE_POLICY_RAW, rateBps: 10001 }, "RATE_INVALID"],
    ["fractional rate", { ...FIXTURE_POLICY_RAW, rateBps: 10.5 }, "RATE_INVALID"],
    ["string rate", { ...FIXTURE_POLICY_RAW, rateBps: "1000" }, "RATE_INVALID"],
    ["missing rate", { ...FIXTURE_POLICY_RAW, rateBps: undefined }, "RATE_INVALID"],
    ["missing rounding", { ...FIXTURE_POLICY_RAW, rounding: undefined }, "ROUNDING_UNSUPPORTED"],
    ["negative hold", { ...FIXTURE_POLICY_RAW, holdDays: -1 }, "HOLD_INVALID"],
    ["missing hold (no silent default)", { ...FIXTURE_POLICY_RAW, holdDays: undefined }, "HOLD_INVALID"],
  ])("rejects incomplete/invalid policy: %s", (_n, raw, reason) => {
    expect(resolveLeadFeeRewardPolicy(raw)).toEqual({ status: "UNAPPROVED", reason });
  });

  it("accepts a complete policy and copies it verbatim", () => {
    expect(approved).toEqual({ status: "APPROVED", policy: FIXTURE_POLICY_RAW });
  });
});

describe("M162 — eligibility", () => {
  it("eligible for a confirmed EUR purchase with a valid attribution", () => {
    expect(evaluateLeadFeeRewardEligibility(input()).eligible).toBe(true);
  });

  it.each([
    ["no ledger entry", { sourceEntry: null }, "SOURCE_ENTRY_MISSING"],
    ["unsupported entry type", { sourceEntry: entry({ entryType: "REFUND" }) }, "SOURCE_ENTRY_UNSUPPORTED_TYPE"],
    ["non-EUR currency", { sourceEntry: entry({ currency: "USD" }) }, "UNSUPPORTED_CURRENCY"],
    ["PENDING_PAYMENT", { purchaseStatus: "PENDING_PAYMENT" }, "PURCHASE_NOT_CONFIRMED"],
    ["REFUNDED", { purchaseStatus: "REFUNDED" }, "PURCHASE_NOT_CONFIRMED"],
    ["REVOKED", { purchaseStatus: "REVOKED" }, "PURCHASE_NOT_CONFIRMED"],
    ["DISPUTED", { purchaseStatus: "DISPUTED" }, "PURCHASE_NOT_CONFIRMED"],
    ["FAILED", { purchaseStatus: "FAILED" }, "PURCHASE_NOT_CONFIRMED"],
    ["malformed net fee", { sourceEntry: entry({ netFeeAmount: "18.005" }) }, "BASIS_INVALID"],
    ["negative net fee", { sourceEntry: entry({ netFeeAmount: "-1.00" }) }, "BASIS_INVALID"],
    ["no attribution", { attribution: null }, "NO_ATTRIBUTION"],
    ["attribution subject differs from policy", { attribution: attribution({ referredParty: "CUSTOMER" }) }, "ATTRIBUTION_SUBJECT_MISMATCH"],
    ["no referred user", { attribution: attribution({ referredUserId: null }) }, "ATTRIBUTION_INCOMPLETE"],
    ["self-referral", { attribution: attribution({ referredUserId: "user-partner" }) }, "SELF_REFERRAL"],
    ["partner not approved", { attribution: attribution({ partnerApproved: false }) }, "PARTNER_NOT_APPROVED"],
    ["code deactivated", { attribution: attribution({ referralCodeActive: false }) }, "REFERRAL_CODE_INACTIVE"],
    ["reward rounds to zero", { sourceEntry: entry({ netFeeAmount: "0.04" }) }, "REWARD_ZERO"],
  ] as const)("ineligible: %s", (_n, override, reason) => {
    const r = evaluateLeadFeeRewardEligibility(input(override as Partial<LeadFeeRewardEligibilityInput>));
    expect(r).toMatchObject({ eligible: false, reason });
  });

  it("the gross total / tax is never the basis: only netFeeAmount is read", () => {
    const e = { ...entry(), totalCollectedAmount: "21.78", taxAmount: "3.78" } as LeadFeeRewardSourceEntry;
    expect(calculateLeadFeeRewardAmount(e.netFeeAmount, { rateBps: 1000, rounding: "HALF_UP" })).toBe("1.80");
  });
});

describe("M162 — exact arithmetic", () => {
  it.each([
    ["18.00", 1000, "HALF_UP", "1.80"],
    ["0.05", 1000, "HALF_UP", "0.01"], // 0.005 -> half up
    ["0.05", 1000, "DOWN", "0.00"],
    ["0.15", 1000, "HALF_UP", "0.02"], // 0.015 -> 0.02 (float math would give 0.01 or 0.02 unpredictably)
    ["33.33", 3333, "DOWN", "11.10"],
    ["33.33", 3333, "HALF_UP", "11.11"],
    ["999999999999.99", 10000, "HALF_UP", "999999999999.99"],
    ["0.00", 500, "HALF_UP", "0.00"],
  ] as const)("net %s @ %s bps (%s) = %s", (net, rateBps, rounding, expected) => {
    expect(calculateLeadFeeRewardAmount(net, { rateBps, rounding })).toBe(expected);
  });

  it("refuses malformed input instead of guessing", () => {
    expect(() => calculateLeadFeeRewardAmount("1e2", { rateBps: 100, rounding: "DOWN" })).toThrow();
    expect(() => calculateLeadFeeRewardAmount("1.234", { rateBps: 100, rounding: "DOWN" })).toThrow();
    expect(() => calculateLeadFeeRewardAmount("1.00", { rateBps: 0, rounding: "DOWN" })).toThrow();
  });

  it("hold: release instant = confirmation + holdDays (0 allowed only because the policy says so)", () => {
    const at = new Date("2026-10-01T10:00:00.000Z");
    expect(computeLeadFeeRewardReleaseAt(at, 30).toISOString()).toBe("2026-10-31T10:00:00.000Z");
    expect(computeLeadFeeRewardReleaseAt(at, 0).toISOString()).toBe(at.toISOString());
  });
});

describe("M162 — reversal arithmetic", () => {
  it("full reversal removes exactly what remains; a replay removes 0.00", () => {
    expect(calculateLeadFeeRewardReversalAmount("1.80", "0.00")).toBe("1.80");
    expect(calculateLeadFeeRewardReversalAmount("1.80", "1.80")).toBe("0.00");
  });
  it("never goes negative or over the original", () => {
    expect(() => calculateLeadFeeRewardReversalAmount("1.80", "1.81")).toThrow();
    expect(() => calculateLeadFeeRewardReversalAmount("x", "0.00")).toThrow();
  });
});

describe("M162 — static boundary contract", () => {
  const src = readFileSync(resolve(process.cwd(), "src/core/domain/services/lead-fee-affiliate-reward.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("imports nothing from legacy payment/commission/payout code, the DB, or the network", () => {
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      "@/domain/services/affiliate-fraud-rules",
      "@/domain/services/fixed-point-decimal",
      "@/domain/services/lead-fee-revenue-ledger",
    ]);
  });
  it("uses no floating point for money and no reward constants", () => {
    expect(code).not.toMatch(/parseFloat|Math\.round|toFixed|Number\(/);
    expect(code).not.toMatch(/AFFILIATE_COMMISSION_RATE_BPS/);
  });
  it("does not reference job value estimates", () => {
    expect(code).not.toMatch(/estimatedJobValue|JobValue|jobValue/);
  });
});
