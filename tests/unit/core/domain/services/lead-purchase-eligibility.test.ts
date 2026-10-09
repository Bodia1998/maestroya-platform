import { describe, expect, it } from "vitest";

import { LeadPurchaseEligibilityPolicy } from "@/application/services/lead-purchase-eligibility-policy";
import { DomainError } from "@/domain/errors/domain-error";
import {
  LEAD_PURCHASE_INELIGIBILITY_REASONS,
  LeadPurchaseNotEligibleError,
  decideLeadPurchaseEligibility,
  decideProfessionalVerificationEligibility,
  isLeadPurchaseIneligibilityReason,
} from "@/domain/services/lead-purchase-eligibility";
import { evaluateBillingIdentityReadiness } from "@/domain/services/professional-billing-identity";

import { READY_BILLING, fakeBillingReadiness } from "../../../../test-utils/lead-purchase-eligibility-fixtures";

/** Module 147 — the pure policy and the application service that feeds it M146's readiness. */
const PRO = { id: "pro-1", status: "ACTIVE", verificationStatus: "VERIFIED" };
const ready = { state: "VERIFIED", isComplete: true, isVerified: true, billingReady: true };

describe("M147 policy — M98 half (authoritative: status ACTIVE and verificationStatus VERIFIED)", () => {
  it("eligible only for an ACTIVE, VERIFIED profile", () => {
    expect(decideProfessionalVerificationEligibility(PRO)).toEqual({ eligible: true });
  });

  it("no profile -> NO_PROFESSIONAL_PROFILE (customers and unrelated roles have none)", () => {
    expect(decideProfessionalVerificationEligibility(null)).toEqual({ eligible: false, reason: "NO_PROFESSIONAL_PROFILE" });
  });

  it.each(["INACTIVE", "SUSPENDED", "DELETED", "", "active"])("status %j -> PROFESSIONAL_NOT_ACTIVE", (status) => {
    expect(decideProfessionalVerificationEligibility({ ...PRO, status })).toEqual({ eligible: false, reason: "PROFESSIONAL_NOT_ACTIVE" });
  });

  it.each(["UNVERIFIED", "PENDING", "REJECTED", "", "verified", "SOMETHING_NEW"])("an ACTIVE profile with verificationStatus %j -> PROFESSIONAL_NOT_VERIFIED (unknown never grants)", (verificationStatus) => {
    expect(decideProfessionalVerificationEligibility({ ...PRO, verificationStatus })).toEqual({ eligible: false, reason: "PROFESSIONAL_NOT_VERIFIED" });
  });

  it("a populated taxId / businessName on the profile is not verification", () => {
    const profile = { ...PRO, verificationStatus: "UNVERIFIED", taxId: "B12345674", businessName: "Acme S.L." };
    expect(decideProfessionalVerificationEligibility(profile)).toEqual({ eligible: false, reason: "PROFESSIONAL_NOT_VERIFIED" });
  });
});

describe("M147 policy — full decision", () => {
  it("M98 + billing ready -> eligible", () => {
    expect(decideLeadPurchaseEligibility({ professional: PRO, billing: ready })).toEqual({ eligible: true });
  });

  it.each([
    ["MISSING", { state: "MISSING", isComplete: false, isVerified: false, billingReady: false }, "BILLING_MISSING"],
    ["PENDING_REVIEW (unverified)", { state: "PENDING_REVIEW", isComplete: true, isVerified: false, billingReady: false }, "BILLING_PENDING_REVIEW"],
    ["NEEDS_CORRECTION (rejected)", { state: "NEEDS_CORRECTION", isComplete: true, isVerified: false, billingReady: false }, "BILLING_NEEDS_CORRECTION"],
    ["VERIFIED but incomplete", { state: "VERIFIED", isComplete: false, isVerified: true, billingReady: false }, "BILLING_INCOMPLETE"],
    ["unknown state", { state: "ARCHIVED", isComplete: true, isVerified: true, billingReady: false }, "BILLING_NOT_READY"],
    ["unknown state claiming ready", { state: "ARCHIVED", isComplete: true, isVerified: true, billingReady: true }, "BILLING_NOT_READY"],
    ["VERIFIED but billingReady false", { state: "VERIFIED", isComplete: true, isVerified: true, billingReady: false }, "BILLING_NOT_READY"],
    ["billingReady true but not verified (contradiction)", { state: "VERIFIED", isComplete: true, isVerified: false, billingReady: true }, "BILLING_NOT_READY"],
    ["billingReady true but incomplete (contradiction)", { state: "VERIFIED", isComplete: false, isVerified: true, billingReady: true }, "BILLING_INCOMPLETE"],
    ["truthy non-boolean billingReady", { state: "VERIFIED", isComplete: true, isVerified: true, billingReady: "yes" as never }, "BILLING_NOT_READY"],
  ])("%s -> %s fails closed", (_name, billing, reason) => {
    expect(decideLeadPurchaseEligibility({ professional: PRO, billing })).toEqual({ eligible: false, reason });
  });

  it("missing readiness (null) fails closed; an M98 failure wins over billing", () => {
    expect(decideLeadPurchaseEligibility({ professional: PRO, billing: null })).toEqual({ eligible: false, reason: "BILLING_NOT_READY" });
    expect(decideLeadPurchaseEligibility({ professional: { ...PRO, verificationStatus: "REJECTED" }, billing: ready })).toEqual({ eligible: false, reason: "PROFESSIONAL_NOT_VERIFIED" });
    expect(decideLeadPurchaseEligibility({ professional: null, billing: ready })).toEqual({ eligible: false, reason: "NO_PROFESSIONAL_PROFILE" });
  });

  it("agrees with the REAL M146 readiness derivation for every persisted state (no second source of truth)", () => {
    const details = { entityType: "COMPANY", legalName: "Acme S.L.", taxId: "B12345674", taxCountry: "ES", addressLine1: "Calle 1", addressLine2: null, city: "Madrid", region: null, postalCode: "28001", country: "ES" } as const;
    const cases = [
      [null, false],
      [{ ...details, verificationStatus: "UNVERIFIED" }, false],
      [{ ...details, verificationStatus: "REJECTED" }, false],
      [{ ...details, verificationStatus: "PENDING" }, false],
      [{ ...details, verificationStatus: "UNKNOWN" }, false],
      [{ ...details, legalName: "", verificationStatus: "VERIFIED" }, false],
      [{ ...details, verificationStatus: "VERIFIED" }, true],
    ] as const;
    for (const [record, expected] of cases) {
      const readiness = evaluateBillingIdentityReadiness(record as never);
      expect(decideLeadPurchaseEligibility({ professional: PRO, billing: readiness }).eligible, JSON.stringify(record?.verificationStatus)).toBe(expected);
    }
  });

  it("every reason is a known closed code", () => {
    expect(LEAD_PURCHASE_INELIGIBILITY_REASONS).toHaveLength(8);
    for (const reason of LEAD_PURCHASE_INELIGIBILITY_REASONS) expect(isLeadPurchaseIneligibilityReason(reason)).toBe(true);
    expect(isLeadPurchaseIneligibilityReason("OTHER")).toBe(false);
    expect(isLeadPurchaseIneligibilityReason(undefined)).toBe(false);
  });

  it("decisions are frozen (a caller cannot flip a shared decision)", () => {
    const decision = decideLeadPurchaseEligibility({ professional: PRO, billing: ready }) as { eligible: boolean };
    expect(Object.isFrozen(decision)).toBe(true);
    expect(() => {
      "use strict";
      decision.eligible = false;
    }).toThrow();
  });
});

describe("M147 error", () => {
  it("is a typed DomainError with a stable code, a static message and only the reason", () => {
    const error = new LeadPurchaseNotEligibleError("BILLING_MISSING");
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("LEAD_PURCHASE_NOT_ELIGIBLE");
    expect(error.reason).toBe("BILLING_MISSING");
    expect(error.message).toBe("Complete your billing details before purchasing leads.");
  });
});

describe("M147 application service — LeadPurchaseEligibilityPolicy", () => {
  it("reads billing readiness with the professional record's id, and ignores any extra field", async () => {
    const reader = fakeBillingReadiness();
    const decision = await new LeadPurchaseEligibilityPolicy(reader).evaluate({ ...PRO, id: "pro-42", billingReady: true, verificationStatus: "VERIFIED" } as never);
    expect(decision).toEqual({ eligible: true });
    expect(reader.calls).toEqual(["pro-42"]);
  });

  it("does not read billing at all for an ineligible M98 state or a missing profile", async () => {
    const reader = fakeBillingReadiness();
    const policy = new LeadPurchaseEligibilityPolicy(reader);
    expect(await policy.evaluate(null)).toEqual({ eligible: false, reason: "NO_PROFESSIONAL_PROFILE" });
    expect(await policy.evaluate({ ...PRO, verificationStatus: "PENDING" })).toEqual({ eligible: false, reason: "PROFESSIONAL_NOT_VERIFIED" });
    expect(await policy.evaluate({ ...PRO, status: "SUSPENDED" })).toEqual({ eligible: false, reason: "PROFESSIONAL_NOT_ACTIVE" });
    expect(reader.calls).toEqual([]);
  });

  it("a null readiness result fails closed and a thrown read is not swallowed into eligibility", async () => {
    expect(await new LeadPurchaseEligibilityPolicy(fakeBillingReadiness(null)).evaluate(PRO)).toEqual({ eligible: false, reason: "BILLING_NOT_READY" });
    const failing = new LeadPurchaseEligibilityPolicy({ execute: async () => Promise.reject(new Error("db down")) });
    await expect(failing.evaluate(PRO)).rejects.toThrow("db down");
  });

  it("never exposes the readiness snapshot (tax id, address): the decision carries only the closed reason", async () => {
    const decision = await new LeadPurchaseEligibilityPolicy({ execute: async () => ({ ...READY_BILLING, state: "PENDING_REVIEW", isVerified: false, billingReady: false }) }).evaluate(PRO);
    expect(decision).toEqual({ eligible: false, reason: "BILLING_PENDING_REVIEW" });
    expect(JSON.stringify(decision)).not.toMatch(/SECRET|taxId|address/i);
  });
});
