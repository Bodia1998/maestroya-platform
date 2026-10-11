import { DomainError } from "@/domain/errors/domain-error";

/**
 * Module 154 (Part A) — Lead Quality Claims: pure domain rules (no I/O).
 *
 * A claim is a professional's statement that a CONFIRMED lead purchase was unusable for one of a CLOSED set of reasons
 * (unreachable or invalid contact, duplicate lead). An administrator reviews it and DECIDES (APPROVED / REJECTED).
 *
 * A claim decision is NOT a financial result. APPROVED never means "refunded": this module has no refund, ledger,
 * invoice or credit-note integration, and the Module 153 refund reasons (PLATFORM_ERROR, DUPLICATE_CHARGE) are unrelated
 * to claim reasons. Workmanship, service quality, the customer's final price and customer/professional conduct after
 * contact are NOT claim reasons.
 */

export const LEAD_QUALITY_CLAIM_REASON_CODES = ["CONTACT_UNREACHABLE", "CONTACT_INVALID", "DUPLICATE_LEAD"] as const;
export type LeadQualityClaimReasonCode = (typeof LEAD_QUALITY_CLAIM_REASON_CODES)[number];

export const LEAD_QUALITY_CLAIM_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
export type LeadQualityClaimStatus = (typeof LEAD_QUALITY_CLAIM_STATUSES)[number];

/** The two decisions an administrator can take. */
export const LEAD_QUALITY_CLAIM_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type LeadQualityClaimDecision = (typeof LEAD_QUALITY_CLAIM_DECISIONS)[number];

/** "Open" = still awaiting a decision. Counted by the open-claim limit. Mirrors the DB trigger. */
export const LEAD_QUALITY_CLAIM_OPEN_STATUSES = ["SUBMITTED", "UNDER_REVIEW"] as const satisfies readonly LeadQualityClaimStatus[];

export function isOpenLeadQualityClaimStatus(status: LeadQualityClaimStatus): boolean {
  return (LEAD_QUALITY_CLAIM_OPEN_STATUSES as readonly string[]).includes(status);
}

/** Mirrors the DB trigger `lead_quality_claims_guard_update`. APPROVED and REJECTED are terminal. */
export const LEAD_QUALITY_CLAIM_TRANSITIONS: Readonly<Record<LeadQualityClaimStatus, readonly LeadQualityClaimStatus[]>> = {
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

export function canTransitionLeadQualityClaim(from: LeadQualityClaimStatus, to: LeadQualityClaimStatus): boolean {
  return (LEAD_QUALITY_CLAIM_TRANSITIONS[from] as readonly string[] | undefined)?.includes(to) ?? false;
}

// ---------------------------------------------------------------- business parameters (approved for Part A; mirrored by the migration)

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A claim may be submitted up to 72 hours after the purchase's `confirmedAt`. */
export const LEAD_QUALITY_CLAIM_WINDOW_HOURS = 72;
/** Response TARGET (not an automatic decision): respondBy = submittedAt + 72 hours. */
export const LEAD_QUALITY_CLAIM_RESPONSE_TARGET_HOURS = 72;
export const LEAD_QUALITY_CLAIM_MAX_OPEN_PER_PROFESSIONAL = 3;
export const LEAD_QUALITY_CLAIM_MAX_SUBMITTED_PER_PERIOD = 10;
export const LEAD_QUALITY_CLAIM_PERIOD_DAYS = 30;

export const LEAD_QUALITY_CLAIM_DESCRIPTION_MIN_LENGTH = 10;
export const LEAD_QUALITY_CLAIM_DESCRIPTION_MAX_LENGTH = 1000;
export const LEAD_QUALITY_CLAIM_EVIDENCE_MAX_LENGTH = 200;
export const LEAD_QUALITY_CLAIM_EXPLANATION_MAX_LENGTH = 1000;

export function leadQualityClaimWindowEnd(confirmedAt: Date): Date {
  return new Date(confirmedAt.getTime() + LEAD_QUALITY_CLAIM_WINDOW_HOURS * HOUR_MS);
}

/** Inclusive on both ends; never before the confirmation. */
export function isWithinLeadQualityClaimWindow(confirmedAt: Date, at: Date): boolean {
  return at.getTime() >= confirmedAt.getTime() && at.getTime() <= leadQualityClaimWindowEnd(confirmedAt).getTime();
}

export function leadQualityClaimRespondBy(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + LEAD_QUALITY_CLAIM_RESPONSE_TARGET_HOURS * HOUR_MS);
}

/** Start of the rolling period ending at `at`. */
export function leadQualityClaimPeriodStart(at: Date): Date {
  return new Date(at.getTime() - LEAD_QUALITY_CLAIM_PERIOD_DAYS * DAY_MS);
}

/**
 * Administrators allowed to review and decide. Deliberately a LOCAL constant (the application layer must not import the
 * infrastructure RBAC table); a unit test pins it to the real `ROLES` values so drift fails the build.
 */
export const LEAD_QUALITY_CLAIM_ALLOWED_ACTOR_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
export const LEAD_QUALITY_CLAIM_ACTOR_ACTIVE_STATUS = "ACTIVE";
/** The claiming professional's profile must be in this status. */
export const LEAD_QUALITY_CLAIM_PROFESSIONAL_ACTIVE_STATUS = "ACTIVE";

// ---------------------------------------------------------------- rejections

export type LeadQualityClaimRejection =
  | "INVALID_INPUT"
  /** Single outcome for: no profile, inactive profile, purchase missing, someone else's purchase, or not CONFIRMED (no probing). */
  | "PURCHASE_NOT_CLAIMABLE"
  | "CLAIM_WINDOW_CLOSED"
  | "ALREADY_CLAIMED"
  | "OPEN_CLAIM_LIMIT_REACHED"
  | "PERIOD_CLAIM_LIMIT_REACHED"
  | "ACTOR_NOT_AUTHORIZED"
  | "CLAIM_NOT_FOUND"
  | "INVALID_TRANSITION";

/** The `reason` is a closed code; the message never carries personal data, claim content or another party's data. */
export class LeadQualityClaimRejectedError extends DomainError {
  readonly code = "LEAD_QUALITY_CLAIM_REJECTED";

  constructor(readonly reason: LeadQualityClaimRejection) {
    super(`Lead quality claim rejected: ${reason}.`);
  }
}

// ---------------------------------------------------------------- input rules

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
const PHONE_LIKE = /(?:\+?\d[\s().-]?){9,}/;
const EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeadQualityClaimReasonCode(value: unknown): value is LeadQualityClaimReasonCode {
  return typeof value === "string" && (LEAD_QUALITY_CLAIM_REASON_CODES as readonly string[]).includes(value);
}

export function isLeadQualityClaimDecision(value: unknown): value is LeadQualityClaimDecision {
  return typeof value === "string" && (LEAD_QUALITY_CLAIM_DECISIONS as readonly string[]).includes(value);
}

export function isLeadQualityClaimUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

function normalizeFreeText(raw: unknown, min: number, max: number): string {
  if (typeof raw !== "string") throw new LeadQualityClaimRejectedError("INVALID_INPUT");
  const text = raw.trim();
  if (text.length < min || text.length > max) throw new LeadQualityClaimRejectedError("INVALID_INPUT");
  // Conservative HEURISTIC (not a guarantee): obvious e-mail addresses, URLs and phone-like digit runs are rejected so that a
  // claim never carries (or leaks) the customer's contact data. Text is stored verbatim, never truncated.
  if (EMAIL.test(text) || URL_LIKE.test(text) || PHONE_LIKE.test(text)) throw new LeadQualityClaimRejectedError("INVALID_INPUT");
  return text;
}

/** Mandatory, 10..1000 characters after trim. */
export function normalizeLeadQualityClaimDescription(raw: unknown): string {
  return normalizeFreeText(raw, LEAD_QUALITY_CLAIM_DESCRIPTION_MIN_LENGTH, LEAD_QUALITY_CLAIM_DESCRIPTION_MAX_LENGTH);
}

/** Mandatory for BOTH approval and rejection, 1..1000 characters after trim. */
export function normalizeLeadQualityClaimDecisionExplanation(raw: unknown): string {
  return normalizeFreeText(raw, 1, LEAD_QUALITY_CLAIM_EXPLANATION_MAX_LENGTH);
}

/** Optional opaque id (ticket id, screenshot id ...), never free text. `undefined`/`null` = none. */
export function normalizeLeadQualityClaimEvidenceReference(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new LeadQualityClaimRejectedError("INVALID_INPUT");
  const text = raw.trim();
  if (text.length < 1 || text.length > LEAD_QUALITY_CLAIM_EVIDENCE_MAX_LENGTH || !EVIDENCE_REFERENCE.test(text)) {
    throw new LeadQualityClaimRejectedError("INVALID_INPUT");
  }
  return text;
}
