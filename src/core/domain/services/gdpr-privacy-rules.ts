/**
 * Module 38 — GDPR Compliance: pure, dependency-free business rules for
 * data export eligibility and account-deletion classification — same
 * small-helper style as dispute-rules.ts/review-rules.ts. This is the
 * single source of truth both `ExportPersonalDataUseCase` and
 * `PrepareAccountDeletionUseCase` read from; neither use case encodes its
 * own "can this be deleted" logic.
 *
 * No product/legal spec existed for these decisions before this module —
 * the classification below is this module's own MVP interpretation of
 * GDPR's erasure right (Art. 17) balanced against its own exceptions
 * (Art. 17(3): legal obligations, establishment/defense of legal claims),
 * applied to this platform's actual data categories (see
 * `application/use-cases/gdpr/gdpr-data-inventory.ts` for how each Prisma-
 * backed entity maps onto one of these categories).
 */

export type DeletionStrategyValue = "HARD_DELETE" | "ANONYMIZE" | "RETAIN";

/**
 * The GDPR-relevant data categories this platform's domain is grouped
 * into for deletion-planning purposes. Deliberately coarser than "one
 * category per Prisma model" — several structurally different entities
 * (e.g. ServiceRequest, Quote, Appointment) share the same deletion
 * treatment and legal rationale, so they're grouped under one category
 * rather than each getting a separate, identically-reasoned rule.
 */
export const GDPR_DATA_CATEGORIES = [
  "AUTH_CREDENTIALS",
  "PROFILE_DATA",
  "MARKETPLACE_ACTIVITY",
  "MARKETPLACE_FINANCIAL",
  "MESSAGES",
  "REVIEWS",
  "NOTIFICATIONS",
  "DISPUTES_AND_SUPPORT",
  "VERIFICATION_DOCUMENTS",
  "AUDIT_LOG",
  "CONSENT_RECORDS",
  "COMPANY_MEMBERSHIP",
  /** Module 96 — Referral & Affiliate Production Wiring: the visitor
   *  attribution and partner-profile identifiers a referred/referring
   *  user leaves behind (`MarketingAttribution.userId`, `Partner.
   *  displayName`/`contactEmail`/`payoutDetails`/`notes`) — anonymized on
   *  erasure, same rationale as PROFILE_DATA. */
  "REFERRAL_ATTRIBUTION",
  /** Module 96: `AffiliateCommission`/`AffiliateCommissionReversal`/
   *  `PartnerPayout` rows — retained, same rationale/legal basis as
   *  MARKETPLACE_FINANCIAL, applied to the affiliate/commission domain
   *  specifically (a real payout already moved real money; the ledger
   *  trail must survive the partner's own account being erased). */
  "AFFILIATE_FINANCIAL",
] as const;

export type GdprDataCategoryValue = (typeof GDPR_DATA_CATEGORIES)[number];

interface CategoryClassification {
  strategy: DeletionStrategyValue;
  reason: string;
}

/**
 * The decision for each category, plus the human-readable rationale a
 * deletion-plan report surfaces. Kept as one literal map (rather than a
 * switch) so every category is provably classified — TypeScript's
 * `Record<GdprDataCategoryValue, ...>` rejects a build that's missing one.
 */
const CATEGORY_CLASSIFICATION: Record<GdprDataCategoryValue, CategoryClassification> = {
  AUTH_CREDENTIALS: {
    strategy: "HARD_DELETE",
    reason: "Login credentials and sessions have no purpose once the account is gone; safe to hard-delete.",
  },
  PROFILE_DATA: {
    strategy: "ANONYMIZE",
    reason:
      "Name/contact/address fields are anonymized (not hard-deleted) because other users' marketplace history " +
      "(jobs, reviews, disputes) still references this user and must remain intelligible after they leave.",
  },
  MARKETPLACE_ACTIVITY: {
    strategy: "ANONYMIZE",
    reason:
      "Service requests, quotes, and appointments with no completed payment attached are anonymized — the " +
      "counterparty's own records (e.g. a professional's quote history) still need the row to exist.",
  },
  MARKETPLACE_FINANCIAL: {
    strategy: "RETAIN",
    reason:
      "Jobs (and any payment/commission tied to them) must be retained for tax, accounting, and dispute-defense " +
      "purposes (GDPR Art. 17(3)(b)/(e)) — never deleted or anonymized while a legal retention period applies.",
  },
  MESSAGES: {
    strategy: "ANONYMIZE",
    reason: "Message content is kept for the conversation's other participant; the sender's identity is stripped.",
  },
  REVIEWS: {
    strategy: "ANONYMIZE",
    reason:
      "A review's rating/comment is part of the reviewed professional's public reputation and is preserved; " +
      "the author's identity is anonymized.",
  },
  NOTIFICATIONS: {
    strategy: "HARD_DELETE",
    reason: "Purely operational, single-user records with no value to any other party once the account is gone.",
  },
  DISPUTES_AND_SUPPORT: {
    strategy: "RETAIN",
    reason: "Dispute and support-ticket history must be retained for legal-claim defense (GDPR Art. 17(3)(e)).",
  },
  VERIFICATION_DOCUMENTS: {
    strategy: "HARD_DELETE",
    reason:
      "Identity/business verification documents are sensitive personal data with no retention obligation once " +
      "the account is deleted; hard-deleted rather than anonymized or retained.",
  },
  AUDIT_LOG: {
    strategy: "RETAIN",
    reason: "The audit trail is an append-only legal/security record (see AdminAuditLogRepository) and is never edited or purged for a single user.",
  },
  CONSENT_RECORDS: {
    strategy: "RETAIN",
    reason: "Proof that consent was once granted/withdrawn must survive account deletion to demonstrate past compliance.",
  },
  COMPANY_MEMBERSHIP: {
    strategy: "ANONYMIZE",
    reason: "Company membership history (who held which role, and when) is kept for the company's own record; the member's identity is anonymized.",
  },
  REFERRAL_ATTRIBUTION: {
    strategy: "ANONYMIZE",
    reason:
      "A referral click/attribution's aggregate value (which campaign drove a conversion) is kept for the " +
      "referring partner's own record; the referred user's identity (MarketingAttribution.userId) and, if the " +
      "erased user is themselves a partner, their own contact/payout details are anonymized.",
  },
  AFFILIATE_FINANCIAL: {
    strategy: "RETAIN",
    reason:
      "Affiliate commissions, reversals, and payouts must be retained for tax, accounting, and dispute-defense " +
      "purposes (GDPR Art. 17(3)(b)/(e)) — a payout already moved real money and can never be deleted or " +
      "anonymized while a legal retention period applies.",
  },
};

/** The deletion strategy for a given data category — the single decision
 *  function both use cases must go through. */
export function classifyDataCategory(category: GdprDataCategoryValue): DeletionStrategyValue {
  return CATEGORY_CLASSIFICATION[category].strategy;
}

/** The human-readable rationale behind a category's classification, for
 *  the deletion-plan report. */
export function retentionReasonFor(category: GdprDataCategoryValue): string {
  return CATEGORY_CLASSIFICATION[category].reason;
}

/** Convenience predicates built on `classifyDataCategory` — kept here
 *  rather than re-derived at each call site. */
export function canHardDelete(category: GdprDataCategoryValue): boolean {
  return classifyDataCategory(category) === "HARD_DELETE";
}

export function shouldAnonymize(category: GdprDataCategoryValue): boolean {
  return classifyDataCategory(category) === "ANONYMIZE";
}

export function shouldRetain(category: GdprDataCategoryValue): boolean {
  return classifyDataCategory(category) === "RETAIN";
}

/**
 * Minimal shape `isExportEligible`/`isAccountDeletable` need — deliberately
 * not the full `AuthUserRecord`, so this stays a pure function callable
 * from a unit test with a bare object literal.
 */
export interface GdprSubjectStatus {
  /** `AuthUserRecord.status`/`User.status` — a plain string, not the
   *  `UserStatus` Prisma enum (this file stays framework-agnostic, same
   *  convention as every other domain/services/*.ts file). */
  status: string;
}

/** A SUSPENDED or otherwise deactivated account can still exercise its
 *  export right — GDPR Art. 20 does not condition data portability on
 *  account standing. Only a user who no longer exists at all has nothing
 *  left to export (that case is a 404 at the use-case level, not modeled
 *  here). */
export function isExportEligible(_subject: GdprSubjectStatus): boolean {
  return true;
}

/**
 * Whether an account-deletion plan may be prepared for this subject.
 * Always true today — this module only ever *prepares a plan*, never
 * performs the deletion itself (see `PrepareAccountDeletionUseCase`'s own
 * doc comment), so there is no state that makes preparing a report unsafe.
 * Kept as an explicit named rule (rather than inlined `true` at the call
 * site) so a future module that actually performs deletion has a single,
 * already-tested place to add real preconditions (e.g. "no OPEN dispute
 * naming this user as respondent").
 */
export function isAccountDeletionPreparable(_subject: GdprSubjectStatus): boolean {
  return true;
}
