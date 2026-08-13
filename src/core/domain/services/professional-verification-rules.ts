/**
 * Professional Verification module (Module 17): pure, dependency-free
 * business rules for the ProfessionalVerification aggregate — same
 * small-helper style as review-rules.ts/portfolio-rules.ts/notification-
 * rules.ts, kept independently unit-testable with exactly one definition
 * rather than scattered `if` checks across use cases.
 *
 * These rules are the single source of truth for the verification state
 * machine and are enforced server-side in every use case. The UI may hide
 * actions that aren't allowed, but never relies on that for correctness —
 * the use cases re-check here regardless of what the client sent.
 */

export const PROFESSIONAL_VERIFICATION_STATUS_VALUES = [
  "DRAFT",
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "RESUBMISSION_REQUIRED",
  "EXPIRED",
] as const;
export type ProfessionalVerificationStatusValue = (typeof PROFESSIONAL_VERIFICATION_STATUS_VALUES)[number];

/** Reuses the existing VerificationDocumentType enum (see schema.prisma) —
 *  no parallel document-type enum is introduced by this module. */
export const VERIFICATION_DOCUMENT_TYPE_VALUES = [
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
export type VerificationDocumentTypeValue = (typeof VERIFICATION_DOCUMENT_TYPE_VALUES)[number];

export const VERIFICATION_DOCUMENT_STATUS_VALUES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const;
export type VerificationDocumentStatusValue = (typeof VERIFICATION_DOCUMENT_STATUS_VALUES)[number];

/** A reason (rejection / resubmission request) is required, non-empty, and
 *  bounded. Same "reason has sane length limits" requirement the module spec
 *  calls out. */
export const MIN_REVIEW_REASON_LENGTH = 10;
export const MAX_REVIEW_REASON_LENGTH = 1000;

/** Guardrail so a single case can't be stuffed with an unbounded number of
 *  uploads. */
export const MAX_DOCUMENTS_PER_VERIFICATION = 20;

/** An APPROVED verification is valid for this long; past `expiresAt` it is
 *  treated as EXPIRED and a fresh case may be opened. */
export const APPROVAL_VALIDITY_DAYS = 365;

/** Document types that satisfy the "at least one proof of identity" rule
 *  required before a case may be submitted for review. */
export const IDENTITY_DOCUMENT_TYPES: readonly VerificationDocumentTypeValue[] = [
  "NATIONAL_ID",
  "PASSPORT",
  "DRIVER_LICENSE",
];

/**
 * The verification state machine. DRAFT is the pre-submission assembly
 * state; PENDING is "in the admin queue"; the terminal-for-this-case state
 * is EXPIRED (an APPROVED case only ever leaves via expiry). REJECTED and
 * RESUBMISSION_REQUIRED both allow the professional to come back around to
 * PENDING. See docs/MODULE_17_PROFESSIONAL_VERIFICATION.md.
 */
const TRANSITIONS: Record<ProfessionalVerificationStatusValue, ProfessionalVerificationStatusValue[]> = {
  DRAFT: ["PENDING"],
  PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"],
  RESUBMISSION_REQUIRED: ["PENDING", "UNDER_REVIEW"],
  REJECTED: ["PENDING"],
  APPROVED: ["EXPIRED"],
  EXPIRED: [],
};

export function canTransition(
  from: ProfessionalVerificationStatusValue,
  to: ProfessionalVerificationStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * "Active" = a case that currently occupies the professional's single slot
 * and therefore blocks opening a new one. Everything except EXPIRED counts —
 * a REJECTED or RESUBMISSION_REQUIRED case is still the professional's
 * current case (they resubmit into it), and an APPROVED case obviously is.
 */
export function isActiveStatus(status: ProfessionalVerificationStatusValue): boolean {
  return status !== "EXPIRED";
}

/** Admin may start a review only from the queued PENDING state. */
export function canStartReview(status: ProfessionalVerificationStatusValue): boolean {
  return status === "PENDING";
}

/** Admin decisions are valid from PENDING or UNDER_REVIEW. */
export function canApprove(status: ProfessionalVerificationStatusValue): boolean {
  return status === "PENDING" || status === "UNDER_REVIEW";
}
export function canReject(status: ProfessionalVerificationStatusValue): boolean {
  return status === "PENDING" || status === "UNDER_REVIEW";
}
export function canRequestResubmission(status: ProfessionalVerificationStatusValue): boolean {
  return status === "PENDING" || status === "UNDER_REVIEW";
}

/** Professional's first submission (DRAFT → PENDING). */
export function canSubmit(status: ProfessionalVerificationStatusValue): boolean {
  return status === "DRAFT";
}

/** Professional resubmitting after being asked to, or after a rejection. */
export function canResubmit(status: ProfessionalVerificationStatusValue): boolean {
  return status === "RESUBMISSION_REQUIRED" || status === "REJECTED";
}

/**
 * A professional may add/remove documents only before the case has been
 * submitted (DRAFT) or while an admin has explicitly asked for a
 * resubmission. Once PENDING/UNDER_REVIEW/APPROVED, the document set is
 * frozen so a reviewer always sees exactly what was submitted.
 */
export function canModifyDocuments(status: ProfessionalVerificationStatusValue): boolean {
  return status === "DRAFT" || status === "RESUBMISSION_REQUIRED";
}

/** At least one proof-of-identity document must be present before a case can
 *  be submitted for review. */
export function hasRequiredDocuments(documentTypes: readonly string[]): boolean {
  return documentTypes.some((t) => (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(t));
}

/** A review reason (rejection / resubmission request) is required,
 *  non-empty after trimming, and within length bounds. */
export function isValidReviewReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_REVIEW_REASON_LENGTH && trimmed.length <= MAX_REVIEW_REASON_LENGTH;
}

/** The instant an approval taken at `from` should expire. */
export function computeExpiresAt(from: Date): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + APPROVAL_VALIDITY_DAYS);
  return expires;
}

/** Normalizes an optional free-text field: trims, collapses empty → null.
 *  Same convention as normalizeOptionalText elsewhere. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ============================================================================
// Module 59 — Professional Verification (Persona)
// ============================================================================
//
// Everything below extends this same rules file rather than starting a
// parallel one — the module was built under an explicit "extend Module 17,
// do not duplicate its business rules" constraint (see
// docs/MODULE_59_PROFESSIONAL_VERIFICATION_PERSONA.md). It adds exactly two
// things: the provider-selector vocabulary, and the payout-eligibility
// predicate every one of these `ProfessionalVerificationStatusValue`
// values already determines the answer to. The status machine itself
// (TRANSITIONS/canTransition/canApprove/canReject/... above) is untouched.

export const VERIFICATION_PROVIDER_VALUES = ["MANUAL", "PERSONA"] as const;
export type VerificationProviderValue = (typeof VERIFICATION_PROVIDER_VALUES)[number];

/**
 * A professional may (re)start an automated provider verification (Persona
 * `createVerification`) from exactly the same states they could otherwise
 * submit/resubmit a manual case from — starting a Persona inquiry is an
 * alternative *front door* into the same PENDING state, not a separate
 * workflow. See `canSubmit`/`canResubmit` above.
 */
export function canStartProviderVerification(status: ProfessionalVerificationStatusValue): boolean {
  return canSubmit(status) || canResubmit(status);
}

/**
 * A case's provider link may be synced (`refreshStatus`/`getVerification`)
 * only while it is actually in the provider's hands — PENDING (inquiry
 * created/running) or UNDER_REVIEW (an admin has started a manual look but
 * the automated decision may still land first). Syncing a DRAFT case (no
 * provider verification has been started) or a terminal one (APPROVED/
 * REJECTED/RESUBMISSION_REQUIRED/EXPIRED — already decided, one way or
 * another) is a no-op the use case should skip rather than a state the
 * provider could ever legally move.
 */
export function canSyncProviderStatus(status: ProfessionalVerificationStatusValue): boolean {
  return status === "PENDING" || status === "UNDER_REVIEW";
}

/**
 * The single predicate `professional.canReceivePayouts()` (per the Module
 * 59 brief) and the future Stripe Connect payout flow are built on:
 * payouts are blocked for every status except APPROVED, regardless of
 * which `VerificationProviderValue` produced that APPROVED decision — a
 * manually-approved case and a Persona-approved one are equally eligible.
 * Deliberately the *only* place this predicate is defined; the financial
 * layer calls this function (via `CheckPayoutEligibilityUseCase`,
 * application/use-cases/verification/), it never re-derives "is this
 * professional verified" from the status value itself.
 */
export function canReceivePayouts(status: ProfessionalVerificationStatusValue): boolean {
  return status === "APPROVED";
}
