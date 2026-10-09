import { LeadPurchaseEligibilityPolicy, type LeadPurchaseBillingReadinessReader } from "@/application/services/lead-purchase-eligibility-policy";
import type { LeadPurchaseBillingReadinessFacts } from "@/domain/services/lead-purchase-eligibility";

/**
 * Module 147 test helper (tests only): the REAL eligibility policy over a fake M146 readiness reader.
 * Defaults to a verified, complete billing identity, so tests that are not about eligibility keep
 * exercising the unchanged purchase / payment behaviour with a genuinely eligible professional.
 * The extra `snapshot` mirrors the real readiness result, which the policy must never expose.
 */
export const READY_BILLING: LeadPurchaseBillingReadinessFacts & { snapshot: unknown } = {
  state: "VERIFIED",
  isComplete: true,
  isVerified: true,
  billingReady: true,
  snapshot: { taxId: "SECRET-TAX-ID", addressLine1: "SECRET-ADDRESS" },
};

export function fakeBillingReadiness(patch: Partial<LeadPurchaseBillingReadinessFacts> | null = {}): LeadPurchaseBillingReadinessReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    execute: async (id: string) => {
      calls.push(id);
      return (patch === null ? null : { ...READY_BILLING, ...patch }) as never;
    },
  };
}

export function eligibilityPolicy(patch: Partial<LeadPurchaseBillingReadinessFacts> | null = {}) {
  return new LeadPurchaseEligibilityPolicy(fakeBillingReadiness(patch));
}
