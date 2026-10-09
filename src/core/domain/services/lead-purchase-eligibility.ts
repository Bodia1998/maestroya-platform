import { DomainError } from "@/domain/errors/domain-error";
import { isProfessionalEligibleToPurchaseLeads } from "@/domain/services/lead-purchase";

/**
 * Module 147 — LEAD_V1 Professional Eligibility Policy (pure domain rule, no I/O).
 *
 * "May this professional START A NEW lead purchase?" is decided here and nowhere else. The policy
 * COMPOSES two existing, authoritative rules; it re-implements neither:
 *
 *  1. M98 professional identity/business verification — `isProfessionalEligibleToPurchaseLeads`
 *     (lead-purchase.ts): `ProfessionalProfile.status === "ACTIVE"` AND
 *     `ProfessionalProfile.verificationStatus === "VERIFIED"`. The existence of a profile, a
 *     populated `taxId`/`businessName`, or a non-VERIFIED status (UNVERIFIED, PENDING, REJECTED, or
 *     any value this code does not know) is NOT verification.
 *  2. M146 billing readiness — the `billingReady` predicate of `GetProfessionalBillingReadinessUseCase`
 *     (an administrator verified exactly the stored, complete details). Billing completeness and
 *     verification are NOT recomputed here.
 *
 * It decides nothing about tax (M136 stays authoritative), VAT exemption or legal eligibility, and
 * never reads billing details: its input is the four readiness facts only.
 *
 * FAIL CLOSED: anything that is not an explicit, consistent "verified and ready" yields an
 * ineligible decision; unknown states map to a reason, never to eligibility.
 */
export const LEAD_PURCHASE_INELIGIBILITY_REASONS = [
  "NO_PROFESSIONAL_PROFILE",
  "PROFESSIONAL_NOT_ACTIVE",
  "PROFESSIONAL_NOT_VERIFIED",
  "BILLING_MISSING",
  "BILLING_PENDING_REVIEW",
  "BILLING_NEEDS_CORRECTION",
  "BILLING_INCOMPLETE",
  "BILLING_NOT_READY",
] as const;
export type LeadPurchaseIneligibilityReason = (typeof LEAD_PURCHASE_INELIGIBILITY_REASONS)[number];

export type LeadPurchaseEligibilityDecision =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: LeadPurchaseIneligibilityReason };

export const LEAD_PURCHASE_ELIGIBLE: LeadPurchaseEligibilityDecision = Object.freeze({ eligible: true });

export function isLeadPurchaseIneligibilityReason(value: unknown): value is LeadPurchaseIneligibilityReason {
  return typeof value === "string" && (LEAD_PURCHASE_INELIGIBILITY_REASONS as readonly string[]).includes(value);
}

/** The only professional facts the policy reads (a `ProfessionalRecord` satisfies this). */
export interface LeadPurchaseProfessionalFacts {
  status: string;
  verificationStatus: string;
}

/** The only billing facts the policy reads: the M146 readiness shape WITHOUT its snapshot (tax id, address). */
export interface LeadPurchaseBillingReadinessFacts {
  state: string;
  isComplete: boolean;
  isVerified: boolean;
  billingReady: boolean;
}

function ineligible(reason: LeadPurchaseIneligibilityReason): LeadPurchaseEligibilityDecision {
  return Object.freeze({ eligible: false, reason });
}

/** Reason for a readiness that is not "ready". Unknown states are `BILLING_NOT_READY`, never eligible. */
export function billingIneligibilityReason(billing: LeadPurchaseBillingReadinessFacts): LeadPurchaseIneligibilityReason {
  switch (billing.state) {
    case "MISSING":
      return "BILLING_MISSING";
    case "PENDING_REVIEW":
      return "BILLING_PENDING_REVIEW";
    case "NEEDS_CORRECTION":
      return "BILLING_NEEDS_CORRECTION";
    case "VERIFIED":
      // Verified, yet no longer complete/well-formed (or contradictory flags): not ready.
      return billing.isComplete ? "BILLING_NOT_READY" : "BILLING_INCOMPLETE";
    default:
      return "BILLING_NOT_READY";
  }
}

/** M98 part only (no billing read needed). `null` professional = no profile for the session user. */
export function decideProfessionalVerificationEligibility(professional: LeadPurchaseProfessionalFacts | null): LeadPurchaseEligibilityDecision {
  if (!professional) return ineligible("NO_PROFESSIONAL_PROFILE");
  if (isProfessionalEligibleToPurchaseLeads(professional)) return LEAD_PURCHASE_ELIGIBLE;
  return ineligible(professional.status === "ACTIVE" ? "PROFESSIONAL_NOT_VERIFIED" : "PROFESSIONAL_NOT_ACTIVE");
}

/**
 * Full decision. Eligible only when BOTH M98 (status ACTIVE + VERIFIED) and M146
 * (`billingReady === true`, state "VERIFIED", not contradicted by `isVerified`/`isComplete`) hold.
 * `billing` is only consulted once M98 passes; a missing readiness (`null`) fails closed.
 */
export function decideLeadPurchaseEligibility(input: {
  professional: LeadPurchaseProfessionalFacts | null;
  billing: LeadPurchaseBillingReadinessFacts | null;
}): LeadPurchaseEligibilityDecision {
  const verification = decideProfessionalVerificationEligibility(input.professional);
  if (!verification.eligible) return verification;
  const billing = input.billing;
  if (!billing) return ineligible("BILLING_NOT_READY");
  if (billing.billingReady === true && billing.state === "VERIFIED" && billing.isVerified === true && billing.isComplete === true) {
    return LEAD_PURCHASE_ELIGIBLE;
  }
  return ineligible(billingIneligibilityReason(billing));
}

/**
 * A professional who passed M98 may not START a lead purchase because their billing requirements are
 * not met. `reason` is about the CALLER's own state (safe to show them, drives the guidance); the
 * message is static and carries no billing detail. Thrown only to an authenticated, M98-verified
 * professional, so it reveals nothing about any lead (the lead checks come later and stay generic).
 */
export class LeadPurchaseNotEligibleError extends DomainError {
  readonly code = "LEAD_PURCHASE_NOT_ELIGIBLE";

  constructor(readonly reason: LeadPurchaseIneligibilityReason) {
    super("Complete your billing details before purchasing leads.");
  }
}
