import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { computeOnboardingProgress } from "@/domain/services/professional-onboarding-rules";
import {
  decideLeadPurchaseEligibility,
  type LeadPurchaseBillingReadinessFacts,
} from "@/domain/services/lead-purchase-eligibility";

/**
 * Module 148 — static + behavioural contract for the onboarding / payout decoupling:
 * onboarding completion is not payout state, is not billing readiness, and is not lead-purchase
 * eligibility; the legacy payout flow keeps its own payout-account checks.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const SRC = walk(path.join(root, "src")).map(rel).filter((f) => /\.(ts|tsx)$/.test(f));
const ONBOARDING_DIR = "src/core/application/use-cases/onboarding/";
const RULES = "src/core/domain/services/professional-onboarding-rules.ts";

describe("M148 — onboarding does not require payout", () => {
  it("the activation requirement set excludes the payout step and the progress computation only counts required steps", () => {
    const src = code(RULES);
    const required = src.slice(src.indexOf("ONBOARDING_REQUIRED_STEP_VALUES = ["), src.indexOf("] as const", src.indexOf("ONBOARDING_REQUIRED_STEP_VALUES = [")));
    expect(required).not.toContain("PAYOUT_CONNECTED");
    expect(src).toContain("isEligibleForActivation: steps.every((s) => s.complete)");
    expect(src).toContain("ONBOARDING_REQUIRED_STEP_VALUES.map");
  });

  it("activation and validation never read the payout account", () => {
    for (const f of [
      `${ONBOARDING_DIR}activate-professional.use-case.ts`,
      `${ONBOARDING_DIR}validate-professional-activation.use-case.ts`,
    ]) {
      expect(code(f), f).not.toMatch(/payout/i);
    }
  });

  it("identity and business-registration verification remain required steps", () => {
    const src = code(RULES);
    expect(src).toMatch(/ONBOARDING_REQUIRED_STEP_VALUES = \[[\s\S]*"IDENTITY_VERIFIED"[\s\S]*"BUSINESS_REGISTRATION_VERIFIED"[\s\S]*\] as const/);
  });
});

describe("M148 — onboarding is not billing readiness or lead-purchase eligibility", () => {
  it("no billing / eligibility / lead-purchase code reads the onboarding aggregate", () => {
    const consumers = SRC.filter(
      (f) =>
        !f.startsWith(ONBOARDING_DIR) &&
        /billing|lead-purchase|lead-fee|lead-checkout|lead-contact/i.test(f) &&
        !/professional-onboarding/.test(f),
    );
    expect(consumers.length).toBeGreaterThan(0);
    for (const f of consumers) {
      expect(code(f), f).not.toMatch(/professional-onboarding|use-cases\/onboarding|OnboardingStatus|ACTIVATED/);
    }
  });

  it("the onboarding use cases do not read or write billing identity or lead-purchase state", () => {
    for (const f of SRC.filter((x) => x.startsWith(ONBOARDING_DIR))) {
      expect(code(f), f).not.toMatch(/billing|BillingIdentity|LeadPurchase|lead-purchase|leadPurchase/);
    }
    expect(code(RULES)).not.toMatch(/billing|LeadPurchase/i);
  });

  it("nothing outside the onboarding module composes the M62 activation use cases (ACTIVATED gates nothing)", () => {
    const users = SRC.filter((f) => !f.startsWith(ONBOARDING_DIR) && /use-cases\/onboarding\/compose/.test(code(f)));
    expect(users).toEqual([]);
  });

  it("an onboarding-complete professional with no verified billing and no VERIFIED profile is still ineligible (M147 authority)", () => {
    const progress = computeOnboardingProgress({
      termsAccepted: true,
      privacyPolicyAccepted: true,
      identityVerificationStatus: "APPROVED",
      verificationDocumentTypes: ["BUSINESS_REGISTRATION"],
      profile: {
        businessName: "Acme",
        bio: "bio",
        contactPhone: "+34600000000",
        serviceRadiusKm: 20,
        yearsExperience: 5,
        categoryIds: ["c"],
        hasPrimaryAddress: true,
      },
      payoutAccountStatus: null,
    });
    expect(progress.isEligibleForActivation).toBe(true);

    const missingBilling: LeadPurchaseBillingReadinessFacts = {
      state: "MISSING",
      isComplete: false,
      isVerified: false,
      billingReady: false,
    };
    const ready: LeadPurchaseBillingReadinessFacts = { state: "VERIFIED", isComplete: true, isVerified: true, billingReady: true };

    expect(decideLeadPurchaseEligibility({ professional: { status: "ACTIVE", verificationStatus: "VERIFIED" }, billing: missingBilling })).toEqual({
      eligible: false,
      reason: "BILLING_MISSING",
    });
    expect(decideLeadPurchaseEligibility({ professional: { status: "ACTIVE", verificationStatus: "UNVERIFIED" }, billing: ready })).toEqual({
      eligible: false,
      reason: "PROFESSIONAL_NOT_VERIFIED",
    });
    expect(decideLeadPurchaseEligibility({ professional: { status: "ACTIVE", verificationStatus: "VERIFIED" }, billing: ready })).toEqual({ eligible: true });
  });
});

describe("M148 — legacy payout flows keep their own guards", () => {
  it("legacy payout destination resolution and eligibility still require a connected payout account / approved verification", () => {
    const resolve = code("src/core/application/use-cases/financial/resolve-payout-destination.use-case.ts");
    expect(resolve).toContain("isPayoutAccountConnected(account.status)");
    expect(resolve).not.toMatch(/ACTIVATED|OnboardingStatus/);
    const check = code("src/core/application/use-cases/verification/check-payout-eligibility.use-case.ts");
    expect(check).toContain("isPayoutAccountConnected(payoutAccount.status)");
    expect(check).not.toMatch(/ACTIVATED|OnboardingStatus/);
  });

  it("the payout destination use case and providers are unchanged in purpose (still present, still not wired into LEAD_V1)", () => {
    expect(SRC).toContain(`${ONBOARDING_DIR}set-payout-destination.use-case.ts`);
    for (const f of SRC.filter((x) => /lead-purchase|lead-fee|lead-checkout|lead-contact/.test(x))) {
      expect(code(f), f).not.toMatch(/payout-provider|stripe-connect|set-payout-destination|ExecuteProfessionalPayout/i);
    }
  });
});
