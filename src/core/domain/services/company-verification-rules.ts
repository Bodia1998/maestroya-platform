/**
 * Module 18 — Company Professional: pure, dependency-free business rules for
 * the CompanyVerification aggregate. Deliberately mirrors
 * professional-verification-rules.ts's (Module 17) state machine and helper
 * shapes exactly — same lifecycle, same reason-length bounds, same document
 * requirement — but operates on `VerificationCaseStatus` (its own enum) so
 * this module never has to touch Module 17's `ProfessionalVerificationStatus`
 * or its working tests. Any future change that should apply to both
 * individual and company verification (e.g. a longer validity period) must
 * be made in both files deliberately, not silently drift apart.
 */

export const VERIFICATION_CASE_STATUS_VALUES = [
  "DRAFT",
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "RESUBMISSION_REQUIRED",
  "EXPIRED",
] as const;
export type VerificationCaseStatusValue = (typeof VERIFICATION_CASE_STATUS_VALUES)[number];

/** Reuses the existing VerificationDocumentType/VerificationDocumentStatus
 *  enums (see schema.prisma) — no parallel document-type enum introduced. */
export const COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES = [
  "NATIONAL_ID",
  "PASSPORT",
  "DRIVER_LICENSE",
  "BUSINESS_LICENSE",
  "TAX_CERTIFICATE",
  "INSURANCE_CERTIFICATE",
  "PROFESSIONAL_CERTIFICATION",
  "PROOF_OF_ADDRESS",
  "OTHER",
] as const;
export type CompanyVerificationDocumentTypeValue = (typeof COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES)[number];

export const MIN_REVIEW_REASON_LENGTH = 10;
export const MAX_REVIEW_REASON_LENGTH = 1000;
export const MAX_DOCUMENTS_PER_VERIFICATION = 20;
export const APPROVAL_VALIDITY_DAYS = 365;

/** A company must prove its legal/business identity, not a personal one —
 *  at least one business-registration-style document, distinct from Module
 *  17's identity-document set (NATIONAL_ID/PASSPORT/DRIVER_LICENSE), which
 *  proves an individual's identity, not a business's. */
export const BUSINESS_DOCUMENT_TYPES: readonly CompanyVerificationDocumentTypeValue[] = [
  "BUSINESS_LICENSE",
  "TAX_CERTIFICATE",
];

const TRANSITIONS: Record<VerificationCaseStatusValue, VerificationCaseStatusValue[]> = {
  DRAFT: ["PENDING"],
  PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"],
  RESUBMISSION_REQUIRED: ["PENDING", "UNDER_REVIEW"],
  REJECTED: ["PENDING"],
  APPROVED: ["EXPIRED"],
  EXPIRED: [],
};

export function canTransition(from: VerificationCaseStatusValue, to: VerificationCaseStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isActiveStatus(status: VerificationCaseStatusValue): boolean {
  return status !== "EXPIRED";
}

export function canStartReview(status: VerificationCaseStatusValue): boolean {
  return status === "PENDING";
}
export function canApprove(status: VerificationCaseStatusValue): boolean {
  return status === "PENDING" || status === "UNDER_REVIEW";
}
export function canReject(status: VerificationCaseStatusValue): boolean {
  return status === "PENDING" || status === "UNDER_REVIEW";
}
export function canRequestResubmission(status: VerificationCaseStatusValue): boolean {
  return status === "PENDING" || status === "UNDER_REVIEW";
}
export function canSubmit(status: VerificationCaseStatusValue): boolean {
  return status === "DRAFT";
}
export function canResubmit(status: VerificationCaseStatusValue): boolean {
  return status === "RESUBMISSION_REQUIRED" || status === "REJECTED";
}
export function canModifyDocuments(status: VerificationCaseStatusValue): boolean {
  return status === "DRAFT" || status === "RESUBMISSION_REQUIRED";
}

export function hasRequiredDocuments(documentTypes: readonly string[]): boolean {
  return documentTypes.some((t) => (BUSINESS_DOCUMENT_TYPES as readonly string[]).includes(t));
}

export function isValidReviewReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_REVIEW_REASON_LENGTH && trimmed.length <= MAX_REVIEW_REASON_LENGTH;
}

export function computeExpiresAt(from: Date): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + APPROVAL_VALIDITY_DAYS);
  return expires;
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
