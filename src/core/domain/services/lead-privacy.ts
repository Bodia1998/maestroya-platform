import { DomainError } from "@/domain/errors/domain-error";

/**
 * Module 158 — GDPR, consent & retention for LEAD_V1: pure domain rules.
 *
 * What this file DECIDES and what it deliberately does NOT:
 *
 *  - The lawful basis for sharing a customer's contact data with a purchasing professional is an OPEN LEGAL DECISION (roadmap D19).
 *    The code therefore never hard-codes it: it is a configuration value (`LeadPrivacyPolicy.contactSharingBasis`). `null` means
 *    "not decided yet" and leaves the pre-M158 behaviour unchanged (no extra gate), it is NOT "consent given".
 *  - Consent is only ONE possible basis. A record stores which basis applied; only a `CONSENT` record can be withdrawn, and only a
 *    `CONSENT` policy requires an affirmative record before contact is released. Acceptance of the terms of service
 *    (`ConsentType.TERMS_OF_SERVICE`) is a different purpose and is never read here.
 *  - Nothing here invents a statutory retention period. `requestContentRetentionDays` is `null` (= do nothing) until an approved
 *    period (roadmap D20) is configured.
 *
 * No Prisma, no I/O, no personal data.
 */

/** The single processing purpose this module records evidence for. */
export const LEAD_CONTACT_SHARING_PURPOSE = "LEAD_CONTACT_SHARING" as const;

export const LEAD_CONTACT_SHARING_BASES = ["CONSENT", "OTHER_LAWFUL_BASIS"] as const;
export type LeadContactSharingBasis = (typeof LEAD_CONTACT_SHARING_BASES)[number];

export function isLeadContactSharingBasis(value: unknown): value is LeadContactSharingBasis {
  return typeof value === "string" && (LEAD_CONTACT_SHARING_BASES as readonly string[]).includes(value);
}

/** Opaque, bounded identifier of the notice / policy text the customer was shown (the text itself is legal copy, not stored here). */
export const MAX_NOTICE_VERSION_LENGTH = 64;
const NOTICE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function isValidNoticeVersion(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_NOTICE_VERSION_LENGTH && NOTICE_VERSION.test(value);
}

export interface LeadPrivacyPolicy {
  /** `null` = lawful basis not decided (D19). */
  contactSharingBasis: LeadContactSharingBasis | null;
  /** Identifier of the notice text currently in force; required to record evidence. */
  noticeVersion: string | null;
  /** `null` = no approved period (D20): the period-based minimization does nothing. */
  requestContentRetentionDays: number | null;
}

export const UNCONFIGURED_LEAD_PRIVACY_POLICY: LeadPrivacyPolicy = Object.freeze({
  contactSharingBasis: null,
  noticeVersion: null,
  requestContentRetentionDays: null,
});

export const MAX_RETENTION_DAYS = 36_500;

export function isValidRetentionDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_RETENTION_DAYS;
}

/** The persisted evidence of one choice / notice for one lead. Ids, a basis, a version and timestamps only — no contact data, no IP. */
export interface LeadContactSharingEvidence {
  basis: LeadContactSharingBasis;
  noticeVersion: string;
  recordedAt: Date;
  withdrawnAt: Date | null;
}

export type ContactSharingDenialReason = "CONSENT_NOT_RECORDED" | "CONSENT_WITHDRAWN";

export type ContactSharingDecision = { allowed: true } | { allowed: false; reason: ContactSharingDenialReason };

/**
 * May contact data be released for this lead as far as the recorded choice is concerned?
 *
 *  - a WITHDRAWN consent always denies (withdrawal is effective for future processing, whatever the policy says today);
 *  - policy basis CONSENT with no record denies (no silent consent: leads created before M158 have no record);
 *  - policy basis CONSENT with a record of another basis denies (a notice is not a consent);
 *  - otherwise allowed (policy undecided, or a non-consent basis: no consent evidence is required).
 */
export function decideContactSharing(
  policy: Pick<LeadPrivacyPolicy, "contactSharingBasis">,
  evidence: LeadContactSharingEvidence | null,
): ContactSharingDecision {
  if (evidence && evidence.basis === "CONSENT" && evidence.withdrawnAt !== null) {
    return { allowed: false, reason: "CONSENT_WITHDRAWN" };
  }
  if (policy.contactSharingBasis === "CONSENT") {
    if (!evidence || evidence.basis !== "CONSENT") return { allowed: false, reason: "CONSENT_NOT_RECORDED" };
  }
  return { allowed: true };
}

/** A consent withdrawal is only meaningful for a record whose basis IS consent. */
export function canWithdrawContactSharing(evidence: Pick<LeadContactSharingEvidence, "basis">): boolean {
  return evidence.basis === "CONSENT";
}

export class LeadPrivacyPolicyNotConfiguredError extends DomainError {
  readonly code = "LEAD_PRIVACY_POLICY_NOT_CONFIGURED";

  constructor() {
    super("The lead contact-sharing policy has not been configured.");
  }
}

export class LeadContactSharingRequiredError extends DomainError {
  readonly code = "LEAD_CONTACT_SHARING_REQUIRED";

  constructor() {
    super("The contact-sharing choice for this request has not been recorded.");
  }
}

export class LeadContactSharingNotApplicableError extends DomainError {
  readonly code = "LEAD_CONTACT_SHARING_NOT_APPLICABLE";

  constructor() {
    super("Consent withdrawal does not apply to this request.");
  }
}

export class LeadContactSharingRecordNotFoundError extends DomainError {
  readonly code = "LEAD_CONTACT_SHARING_NOT_FOUND";

  constructor() {
    super("No contact-sharing record exists for this request.");
  }
}

/** Fixed placeholder written over request free text. Contains no data; also the idempotency marker. */
export const LEAD_REQUEST_ERASED_TEXT = "[erased]";

/**
 * A purchase in one of these statuses keeps its lead's request text OUT of period-based minimization: the fee is unsettled
 * (PENDING_PAYMENT), the purchaser holds live contact access (CONFIRMED) — and may still claim (M154) or be charged back (M155) —
 * or a chargeback is open (DISPUTED). Using the purchase status alone (instead of joining the claim / dispute tables) keeps the M154 /
 * M155 tables behind their own repositories, and errs on the side of keeping evidence: leads that were SOLD stay un-minimized until
 * an advisor-approved rule (roadmap D20) says how long a sold lead's request text may be kept.
 */
export const PURCHASE_STATUSES_BLOCKING_MINIMIZATION = ["PENDING_PAYMENT", "CONFIRMED", "DISPUTED"] as const;

/**
 * The instant at/before which a TERMINAL lead's request text becomes eligible for period-based minimization, or `null` when no
 * approved period is configured (nothing is ever eligible then). Boundary: a lead that became terminal EXACTLY `days` ago IS eligible.
 */
export function requestContentRetentionCutoff(now: Date, days: number | null): Date | null {
  if (days === null) return null;
  if (!isValidRetentionDays(days)) return null; // a corrupt configuration fails safe: nothing is eligible
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function isRequestContentEligibleForMinimization(terminalSince: Date, cutoff: Date | null): boolean {
  return cutoff !== null && terminalSince.getTime() <= cutoff.getTime();
}

export const DEFAULT_LEAD_PRIVACY_BATCH_SIZE = 100;
export const MAX_LEAD_PRIVACY_BATCH_SIZE = 500;

export interface ParsedLeadPrivacyConfig {
  policy: LeadPrivacyPolicy;
  batchSize: number;
  /** Fixed, value-free notes (never the configured values themselves). */
  warnings: string[];
}

/**
 * Parses the process environment into the privacy policy. Pure (the caller passes the environment).
 *
 *   LEAD_CONTACT_SHARING_BASIS          = CONSENT | OTHER_LAWFUL_BASIS   (unset/empty = undecided, D19)
 *                                         any OTHER value fails CLOSED to CONSENT (the stricter gate), never to "undecided"
 *   LEAD_CONTACT_SHARING_NOTICE_VERSION = opaque identifier of the notice text in force (<= 64 chars)
 *   LEAD_REQUEST_CONTENT_RETENTION_DAYS = integer in [1, 36500]          (unset/invalid = NO period, nothing is minimized)
 *   LEAD_PRIVACY_RETENTION_BATCH_SIZE   = integer in [1, 500]            (default 100)
 */
export function parseLeadPrivacyConfig(source: Readonly<Record<string, string | undefined>>): ParsedLeadPrivacyConfig {
  const warnings: string[] = [];
  const clean = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

  let contactSharingBasis: LeadContactSharingBasis | null = null;
  const rawBasis = clean(source.LEAD_CONTACT_SHARING_BASIS);
  if (rawBasis !== undefined) {
    if (isLeadContactSharingBasis(rawBasis)) contactSharingBasis = rawBasis;
    else {
      contactSharingBasis = "CONSENT";
      warnings.push("LEAD_CONTACT_SHARING_BASIS invalid: failing closed to CONSENT");
    }
  }

  let noticeVersion: string | null = null;
  const rawVersion = clean(source.LEAD_CONTACT_SHARING_NOTICE_VERSION);
  if (rawVersion !== undefined) {
    if (isValidNoticeVersion(rawVersion)) noticeVersion = rawVersion;
    else warnings.push("LEAD_CONTACT_SHARING_NOTICE_VERSION invalid: ignored");
  }

  let requestContentRetentionDays: number | null = null;
  const rawDays = clean(source.LEAD_REQUEST_CONTENT_RETENTION_DAYS);
  if (rawDays !== undefined) {
    const n = /^\d+$/.test(rawDays) ? Number(rawDays) : Number.NaN;
    if (isValidRetentionDays(n)) requestContentRetentionDays = n;
    else warnings.push("LEAD_REQUEST_CONTENT_RETENTION_DAYS invalid: no retention period applied");
  }

  let batchSize = DEFAULT_LEAD_PRIVACY_BATCH_SIZE;
  const rawBatch = clean(source.LEAD_PRIVACY_RETENTION_BATCH_SIZE);
  if (rawBatch !== undefined) {
    const n = /^\d+$/.test(rawBatch) ? Number(rawBatch) : Number.NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_LEAD_PRIVACY_BATCH_SIZE) batchSize = n;
    else warnings.push("LEAD_PRIVACY_RETENTION_BATCH_SIZE invalid: default applied");
  }

  return { policy: { contactSharingBasis, noticeVersion, requestContentRetentionDays }, batchSize, warnings };
}
