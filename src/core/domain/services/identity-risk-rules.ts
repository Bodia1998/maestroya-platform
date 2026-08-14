/**
 * Module 65 — Trust & Integrity System: identity-risk rule engine.
 * Requirement #14 — "Integrate with Module 59. Reuse Professional
 * Verification. DO NOT duplicate verification logic." This file never
 * re-implements identity verification: it only classifies risk from a
 * small summary the calling use case derives from Module 59's own
 * `ProfessionalVerificationRepository` (`findActiveByProfessionalProfileId`)
 * — the same "read the existing aggregate's state, don't re-decide it"
 * rule `commission-policy.ts` follows for `CommissionCalculationService`.
 */
import type { ProfessionalVerificationStatusValue } from "@/domain/services/professional-verification-rules";

export interface IdentityVerificationSummary {
  userId: string;
  status: ProfessionalVerificationStatusValue;
  /** Count of past REJECTED cases for this professional — Module 59
   *  already tracks each case's outcome; the use case sums prior rejected
   *  cases before calling in here. */
  pastRejectionCount: number;
  /** True when the case's `expiresAt` (Module 59) has already passed and
   *  no renewal has been started. */
  isExpired: boolean;
}

export interface IdentityRiskFinding {
  reason: "UNVERIFIED_WITH_REPEATED_REJECTIONS" | "EXPIRED_VERIFICATION_STILL_ACTIVE";
  userId: string;
  detail: string;
}

export const IDENTITY_RISK_REJECTION_THRESHOLD = 2;

/**
 * Derives an identity-risk finding from a verification summary. Two
 * signals: a professional who keeps failing verification (never reaches
 * `VERIFIED`) yet keeps operating, and a professional whose verification
 * has expired but who has not started a renewal — both indicate the
 * platform's identity assurance for this account is stale or was never
 * established, independent of *why* Module 59 rejected them (this file
 * never inspects `rejectionReason` text).
 */
export function detectIdentityRisk(summary: IdentityVerificationSummary): IdentityRiskFinding | null {
  if (summary.status !== "APPROVED" && summary.pastRejectionCount >= IDENTITY_RISK_REJECTION_THRESHOLD) {
    return {
      reason: "UNVERIFIED_WITH_REPEATED_REJECTIONS",
      userId: summary.userId,
      detail: `${summary.pastRejectionCount} rejected verification attempts and status is still "${summary.status}" (threshold ${IDENTITY_RISK_REJECTION_THRESHOLD}).`,
    };
  }

  if (summary.isExpired) {
    return {
      reason: "EXPIRED_VERIFICATION_STILL_ACTIVE",
      userId: summary.userId,
      detail: "This professional's verification has expired and no renewal has been started.",
    };
  }

  return null;
}
