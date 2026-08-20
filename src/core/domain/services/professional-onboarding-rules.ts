/**
 * Module 62 — Professional Onboarding.
 *
 * Pure, dependency-free business rules for the Professional Onboarding
 * aggregate — same small-helper style as `professional-verification-
 * rules.ts`/`review-rules.ts`/`portfolio-rules.ts`. This module is an
 * *orchestrator* over existing modules (Module 17/59 identity verification,
 * the Professional profile module, Module 61's provider-abstraction
 * convention for payouts) — it introduces exactly one new state machine
 * (onboarding activation) and reuses every other module's own rules for the
 * inputs that feed it. Nothing here re-implements
 * `professional-verification-rules.ts` or the Professional profile's own
 * validation.
 *
 * See docs/MODULE_62_PROFESSIONAL_ONBOARDING.md for the full module brief.
 */

import {
  hasBusinessRegistrationDocument,
  type ProfessionalVerificationStatusValue,
} from "@/domain/services/professional-verification-rules";

/** The fixed, ordered set of requirements a professional must satisfy
 *  before `ActivateProfessionalUseCase` will move them to ACTIVATED. Order
 *  matters only for display purposes (a wizard-style onboarding UI would
 *  render steps in this order) — activation itself requires all of them,
 *  regardless of the order they were completed in. */
export const ONBOARDING_STEP_VALUES = [
  "TERMS_ACCEPTED",
  "PRIVACY_POLICY_ACCEPTED",
  "IDENTITY_VERIFIED",
  /** Module 74 — Business Registration Enforcement: a solo professional
   *  must also have an APPROVED business-registration document before
   *  activation — see isBusinessRegistrationVerified below. */
  "BUSINESS_REGISTRATION_VERIFIED",
  "PROFILE_COMPLETE",
  "PAYOUT_CONNECTED",
] as const;
export type OnboardingStepValue = (typeof ONBOARDING_STEP_VALUES)[number];

export const ONBOARDING_STATUS_VALUES = ["IN_PROGRESS", "ACTIVATED"] as const;
export type OnboardingStatusValue = (typeof ONBOARDING_STATUS_VALUES)[number];

/**
 * Provider abstraction vocabulary for Step 5 (Bank Account). `IBAN` is the
 * only method this module can itself fully validate/store today;
 * `STRIPE_EXPRESS` is prepared per Step 6's "no Stripe SDK, state only"
 * requirement — see `application/ports/payout-provider.ts` and
 * `infrastructure/payout/stripe-express-payout-provider.ts`. The union is
 * deliberately open to extension by adding one more value plus one more
 * `PayoutProvider` implementation (`infrastructure/payout/payout-provider-
 * factory.ts` is the only place a caller "chooses" one) — no existing
 * method's rules or storage change when a third payout method is added.
 */
export const PAYOUT_METHOD_VALUES = ["IBAN", "STRIPE_EXPRESS"] as const;
export type PayoutMethodValue = (typeof PAYOUT_METHOD_VALUES)[number];

export const PAYOUT_ACCOUNT_STATUS_VALUES = ["PENDING", "VERIFIED", "REJECTED"] as const;
export type PayoutAccountStatusValue = (typeof PAYOUT_ACCOUNT_STATUS_VALUES)[number];

/**
 * Stripe Connect / Stripe Express readiness. This module (62) prepares
 * onboarding *state* for that integration without ever calling the
 * Stripe SDK itself (see the module brief's explicit "Do NOT integrate
 * Stripe SDK" rule): `NOT_STARTED` (default), `PENDING` (the professional
 * has chosen Stripe Express, or Module 71 has created a real account that
 * has not finished onboarding yet), `READY` (Module 71's
 * `GetStripeAccountStatusUseCase` sets this once the account has actually
 * completed onboarding — nothing in this module ever writes `READY`).
 */
export const STRIPE_EXPRESS_READINESS_VALUES = ["NOT_STARTED", "PENDING", "READY"] as const;
export type StripeExpressReadinessValue = (typeof STRIPE_EXPRESS_READINESS_VALUES)[number];

/** Minimal shape `isProfileComplete` needs from a professional's profile —
 *  a subset of `ProfessionalRecord` (`domain/repositories/professional-
 *  repository.ts`), so this file never needs to import that module's full
 *  interface (or any Prisma type) just to check completeness. Deliberately
 *  checks only fields that already exist on `ProfessionalProfile` — this
 *  module verifies completeness, it does not invent new profile fields or
 *  duplicate the Professional module's own validation (`professional.dto.ts`
 *  already owns field-level format rules; this only checks presence). */
export interface ProfileCompletenessInput {
  businessName: string | null;
  bio: string | null;
  contactPhone: string | null;
  serviceRadiusKm: number | null;
  yearsExperience: number | null;
  categoryIds: readonly string[];
  /** Whether the professional has a saved primary address (Module 20 /
   *  `AddressRepository`) — the "working area" / base-location
   *  requirement. Resolved by the caller, not this pure function. */
  hasPrimaryAddress: boolean;
}

/** Verifies completeness only — never mutates or re-validates field-level
 *  formats (that already happens in `professional.dto.ts`'s zod schemas at
 *  the point a professional edits their profile). */
export function isProfileComplete(input: ProfileCompletenessInput): boolean {
  return Boolean(
    input.businessName?.trim() &&
      input.bio?.trim() &&
      input.contactPhone?.trim() &&
      input.serviceRadiusKm !== null &&
      input.serviceRadiusKm !== undefined &&
      input.yearsExperience !== null &&
      input.yearsExperience !== undefined &&
      input.categoryIds.length > 0 &&
      input.hasPrimaryAddress,
  );
}

/**
 * Identity verification is satisfied purely by delegating to Module 17/59's
 * own status machine — `APPROVED` is the one status
 * `professional-verification-rules.ts`'s `canReceivePayouts` already
 * treats as "verified"; this module reuses that exact predicate rather
 * than re-deriving a second definition of "verified" (see the module
 * brief's "Never duplicate KYC" rule).
 */
export function isIdentityVerified(status: ProfessionalVerificationStatusValue | null): boolean {
  return status === "APPROVED";
}

/**
 * Module 74 — Business Registration Enforcement. Satisfied only when the
 * professional's active verification case is APPROVED (this architecture
 * approves/rejects a case as a whole — see ApproveProfessionalVerificationUseCase
 * — there is no separate per-document review step) *and* that case's
 * documents include at least one of the Gestor-configured
 * BUSINESS_REGISTRATION_DOCUMENT_TYPES (professional-verification-rules.ts).
 *
 * This deliberately mirrors isIdentityVerified's shape (status === "APPROVED")
 * plus one extra presence check, rather than inventing a second document
 * lifecycle. A case that is PENDING, REJECTED, RESUBMISSION_REQUIRED, or
 * EXPIRED never satisfies this, matching the module's required PENDING/
 * REJECTED/EXPIRED-block, APPROVED-satisfy behavior; a RESUBMISSION_REQUIRED
 * case clears the professional's prior decision the same way it already
 * does for identity (see professional-verification-rules.ts's TRANSITIONS —
 * the case must move back through PENDING/UNDER_REVIEW to a fresh APPROVED
 * before this is true again).
 */
export function isBusinessRegistrationVerified(
  status: ProfessionalVerificationStatusValue | null,
  documentTypes: readonly string[],
): boolean {
  return status === "APPROVED" && hasBusinessRegistrationDocument(documentTypes);
}

/** A payout account is "connected" for activation purposes once a
 *  destination has been recorded — `PENDING` (freshly submitted IBAN,
 *  awaiting the future admin/bank-level verification step) already counts:
 *  requiring `VERIFIED` here would make activation depend on a
 *  verification workflow this module does not implement (see Step 5/6 of
 *  the module brief — "architecture must support" future providers, not
 *  "must already verify them"). Only an explicitly `REJECTED` destination
 *  fails this check. */
export function isPayoutAccountConnected(status: PayoutAccountStatusValue | null): boolean {
  return status === "PENDING" || status === "VERIFIED";
}

export interface OnboardingStepState {
  step: OnboardingStepValue;
  complete: boolean;
}

export interface OnboardingProgressInput {
  termsAccepted: boolean;
  privacyPolicyAccepted: boolean;
  identityVerificationStatus: ProfessionalVerificationStatusValue | null;
  /** Module 74 — Business Registration Enforcement: the document types
   *  present on the professional's active verification case (empty array
   *  if there is no active case) — the same case identityVerificationStatus
   *  is derived from. See isBusinessRegistrationVerified. */
  verificationDocumentTypes: readonly string[];
  profile: ProfileCompletenessInput;
  payoutAccountStatus: PayoutAccountStatusValue | null;
}

export interface OnboardingProgress {
  steps: OnboardingStepState[];
  completedStepCount: number;
  totalStepCount: number;
  isEligibleForActivation: boolean;
}

/**
 * Computes the professional's progress across every onboarding
 * requirement — the single place `GetOnboardingStatusUseCase` and
 * `ValidateProfessionalActivationUseCase` both derive their answer from,
 * so the two can never disagree about what "complete" means.
 */
export function computeOnboardingProgress(input: OnboardingProgressInput): OnboardingProgress {
  const stepComplete: Record<OnboardingStepValue, boolean> = {
    TERMS_ACCEPTED: input.termsAccepted,
    PRIVACY_POLICY_ACCEPTED: input.privacyPolicyAccepted,
    IDENTITY_VERIFIED: isIdentityVerified(input.identityVerificationStatus),
    BUSINESS_REGISTRATION_VERIFIED: isBusinessRegistrationVerified(
      input.identityVerificationStatus,
      input.verificationDocumentTypes,
    ),
    PROFILE_COMPLETE: isProfileComplete(input.profile),
    PAYOUT_CONNECTED: isPayoutAccountConnected(input.payoutAccountStatus),
  };

  const steps = ONBOARDING_STEP_VALUES.map((step) => ({ step, complete: stepComplete[step] }));
  const completedStepCount = steps.filter((s) => s.complete).length;

  return {
    steps,
    completedStepCount,
    totalStepCount: ONBOARDING_STEP_VALUES.length,
    isEligibleForActivation: steps.every((s) => s.complete),
  };
}

/** Human-readable labels for missing-step reporting (`ValidateProfessional
 *  ActivationUseCase`'s `reasons`) — kept here, next to the step
 *  vocabulary, rather than scattered across use cases/presentation. */
export const ONBOARDING_STEP_LABELS: Record<OnboardingStepValue, string> = {
  TERMS_ACCEPTED: "Accept the Terms & Conditions",
  PRIVACY_POLICY_ACCEPTED: "Accept the Privacy Policy",
  IDENTITY_VERIFIED: "Complete identity verification",
  BUSINESS_REGISTRATION_VERIFIED: "Submit and get approval for a business-registration document",
  PROFILE_COMPLETE: "Complete your professional profile",
  PAYOUT_CONNECTED: "Add a payout destination",
};

// ============================================================================
// Bank Account / Payout destination validation (Step 5 — IBAN)
// ============================================================================

/** Strips spaces/dashes and upper-cases — the normalized form every IBAN
 *  helper below operates on. */
export function normalizeIban(rawIban: string): string {
  return rawIban.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * ISO 13616 IBAN validation: format (2 letters, 2 check digits, up to 30
 * alphanumeric) plus the mod-97 checksum (ISO 7064 MOD 97-10). No network
 * call, no bank-level verification — this only rejects structurally
 * invalid input before it's ever persisted; a structurally valid IBAN for
 * a closed/nonexistent account is caught later, by whatever future payout
 * run actually attempts to pay out to it.
 */
export function isValidIban(rawIban: string): boolean {
  const iban = normalizeIban(rawIban);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));

  // mod-97 over a potentially very long numeric string, computed in
  // manageable chunks so it never overflows Number's safe integer range.
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = String(remainder) + numeric.slice(i, i + 7);
    remainder = Number(chunk) % 97;
  }
  return remainder === 1;
}

/** Never displays/logs a full IBAN — only the last 4 characters, the same
 *  masking convention a bank statement uses. */
export function maskIban(rawIban: string): string {
  const iban = normalizeIban(rawIban);
  const last4 = iban.slice(-4);
  return `****${last4}`;
}
