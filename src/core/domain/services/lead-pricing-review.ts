import { createHash } from "node:crypto";

import { DomainError } from "@/domain/errors/domain-error";
import { LEAD_ADMIN_CONSOLE_ACTIVE_STATUS, LEAD_ADMIN_CONSOLE_ROLES } from "@/domain/services/lead-admin-console";
import type { LeadCalibrationProvenance, ReviewReasonCode } from "@/domain/services/lead-calibrated-estimate";
import type { LeadScopeProvenance } from "@/domain/services/lead-scope-questionnaire";

/**
 * Module 164 — LEAD PRICING REVIEW: the minimal, architecture-consistent human-assessment path for a request the system will
 * not price automatically (confidence below the threshold, no/insufficient calibration, contradictory answers).
 *
 * Why this exists. Before M164 an unpriceable lead simply stayed DRAFT behind a generic refusal; nothing recorded WHY, nobody
 * could act on it and the customer was told nothing true. There is no pre-existing pricing-review mechanism in the repository
 * (the M157 console covers claims, disputes and abuse). This is the smallest addition that closes that gap.
 *
 * Shape. One row per (lead, INPUT FINGERPRINT). The fingerprint is a hash of everything the decision depends on — the lead, its
 * category, the resolved province, the validated scope and the calibration version. Consequences:
 *   - opening a review is idempotent: the same inputs never create a second row (retries and double clicks are harmless);
 *   - a decision binds to exactly the inputs it was made for: if the customer's scope, the region or the calibration
 *     configuration changes afterwards, the old decision no longer matches and a NEW review is opened — an approval can never
 *     publish a price for inputs the administrator did not see (no stale approvals);
 *   - history is never rewritten: a decided row is immutable.
 *
 * What an administrator decides. APPROVE supplies an average job VALUE (not a price). The price is then produced by the same
 * D3 formula, bounds and territory rules as the automatic path (`priceReviewedJobValue`). REJECT keeps the lead unpublished.
 * Neither decision publishes anything by itself: publication stays the customer's idempotent `PublishLead` call, which re-checks
 * the fingerprint and re-prices at that moment.
 */

/**
 * SUPERSEDED is set by the SYSTEM (never by an administrator) on a still-pending review when the lead's inputs change and a
 * new review is opened for the new fingerprint: the old question is no longer the one being asked.
 */
export const LEAD_PRICING_REVIEW_STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export type LeadPricingReviewStatus = (typeof LEAD_PRICING_REVIEW_STATUSES)[number];

export const LEAD_PRICING_REVIEW_ADMIN_ROLES = LEAD_ADMIN_CONSOLE_ROLES;
export const LEAD_PRICING_REVIEW_ACTIVE_STATUS = LEAD_ADMIN_CONSOLE_ACTIVE_STATUS;

export const LEAD_PRICING_REVIEW_NOTE_MAX_LENGTH = 1000;

export type LeadPricingReviewRejection =
  | "ACTOR_NOT_AUTHORIZED"
  | "INVALID_INPUT"
  | "REVIEW_NOT_FOUND"
  | "ALREADY_DECIDED"
  | "VALUE_NOT_PRICEABLE"
  | "CONFIGURATION_UNAVAILABLE"
  | "REVIEW_STALE";

/** Closed reason set; the message never echoes input. */
export class LeadPricingReviewRejectedError extends DomainError {
  readonly code = "LEAD_PRICING_REVIEW_REJECTED";

  constructor(readonly reason: LeadPricingReviewRejection) {
    super(`Lead pricing review request rejected: ${reason}.`);
  }
}

/**
 * What the CUSTOMER learns when a lead needs a human assessment: the truth — it is being reviewed and no price is confirmed.
 * Localised under `errors.byCode.LEAD_PRICING_UNDER_REVIEW`. It says nothing about score, region or configuration.
 */
export class LeadPricingUnderReviewError extends DomainError {
  readonly code = "LEAD_PRICING_UNDER_REVIEW";

  constructor() {
    super("Your request is being reviewed. A price has not been confirmed yet, so it has not been published.");
  }
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

export interface ReviewFingerprintInput {
  leadId: string;
  categorySlug: string;
  parentCategorySlug: string | null;
  provinceCode: string;
  scopeState: "NONE" | "STRUCTURED" | "CONFLICTING";
  scope: LeadScopeProvenance | null;
  calibrationVersion: string;
}

function canonicalAnswers(scope: LeadScopeProvenance | null): [string, string | number][] | null {
  if (!scope) return null;
  return Object.keys(scope.answers)
    .sort()
    .map((k) => [k, scope.answers[k] as string | number]);
}

/** Deterministic SHA-256 of everything the pricing decision depends on. Same inputs -> same fingerprint, always. */
export function computeReviewInputFingerprint(input: ReviewFingerprintInput): string {
  const canonical = JSON.stringify({
    v: 1,
    lead: input.leadId,
    category: input.categorySlug,
    parent: input.parentCategorySlug,
    province: input.provinceCode,
    scopeState: input.scopeState,
    scopeVersion: input.scope?.questionnaireVersion ?? null,
    scopeAnswers: canonicalAnswers(input.scope),
    calibration: input.calibrationVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export const REVIEW_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface LeadPricingReviewRecord {
  id: string;
  leadId: string;
  inputFingerprint: string;
  status: LeadPricingReviewStatus;
  reasonCodes: readonly ReviewReasonCode[];
  categorySlug: string;
  parentCategorySlug: string | null;
  provinceCode: string;
  calibrationVersion: string;
  /** Why it needs review and what the system knew. Opaque ids and codes only: no contact, address or free text. */
  provenance: LeadCalibrationProvenance;
  createdAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  /** APPROVED only: the average job value the administrator assessed, EUR. */
  reviewedJobValue: string | null;
  decisionNote: string | null;
}

export interface OpenLeadPricingReviewInput {
  leadId: string;
  inputFingerprint: string;
  reasonCodes: readonly ReviewReasonCode[];
  categorySlug: string;
  parentCategorySlug: string | null;
  provinceCode: string;
  calibrationVersion: string;
  provenance: LeadCalibrationProvenance;
}

export type LeadPricingReviewDecision =
  | { outcome: "APPROVED"; reviewedJobValue: string; note: string | null }
  | { outcome: "REJECTED"; note: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeadPricingReviewUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

export function isReviewableAdmin(actor: { status?: unknown; roles?: unknown } | null | undefined): boolean {
  if (!actor || actor.status !== LEAD_PRICING_REVIEW_ACTIVE_STATUS || !Array.isArray(actor.roles)) return false;
  const allowed = LEAD_PRICING_REVIEW_ADMIN_ROLES as readonly string[];
  return actor.roles.some((role) => typeof role === "string" && allowed.includes(role));
}

/**
 * Validates an administrator's decision. Free text is a bounded note (no control characters); the APPROVED value is a plain
 * decimal string. Anything malformed is INVALID_INPUT — never coerced.
 */
export function normalizeLeadPricingReviewDecision(input: unknown): LeadPricingReviewDecision {
  if (typeof input !== "object" || input === null) throw new LeadPricingReviewRejectedError("INVALID_INPUT");
  const { outcome, reviewedJobValue, note } = input as Record<string, unknown>;
  let cleanNote: string | null = null;
  if (note !== undefined && note !== null) {
    if (typeof note !== "string" || note.length > LEAD_PRICING_REVIEW_NOTE_MAX_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)) {
      throw new LeadPricingReviewRejectedError("INVALID_INPUT");
    }
    cleanNote = note.trim() === "" ? null : note.trim();
  }
  if (outcome === "REJECTED") return { outcome: "REJECTED", note: cleanNote };
  if (outcome === "APPROVED") {
    if (typeof reviewedJobValue !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(reviewedJobValue)) throw new LeadPricingReviewRejectedError("INVALID_INPUT");
    return { outcome: "APPROVED", reviewedJobValue, note: cleanNote };
  }
  throw new LeadPricingReviewRejectedError("INVALID_INPUT");
}

/** A decided review is final. Only a pending one can be decided. */
export function canDecideLeadPricingReview(status: LeadPricingReviewStatus): boolean {
  return status === "PENDING_REVIEW";
}
