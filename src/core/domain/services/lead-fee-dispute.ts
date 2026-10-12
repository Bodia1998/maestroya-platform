import { DomainError } from "@/domain/errors/domain-error";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 155 — Chargebacks & Access Revocation: pure domain rules (no I/O, no provider SDK).
 *
 * A LeadFeeDispute is MaestroYa's record of ONE provider dispute (chargeback) on ONE lead-fee payment. It exists only to
 * (1) track the dispute, (2) decide what happens to the professional's contact access while and after it is open, and
 * (3) support basic evidence submission. It is NOT a money movement: nothing here refunds, credits, invoices or posts to the
 * revenue ledger (those need an accounting decision that is still open — see docs/MODULE_155_CHARGEBACKS_ACCESS_REVOCATION.md).
 *
 * Access policy (roadmap decision D25, default "suspend"):
 *   CONFIRMED --dispute opened--> DISPUTED (contact access denied)
 *   DISPUTED  --won / inquiry closed without a chargeback--> CONFIRMED (access restored, original confirmedAt kept)
 *   DISPUTED  --lost--> REVOKED (access withdrawn for good, no refund executed by MaestroYa)
 * REVOKED rather than REFUNDED on a loss: REFUNDED means MaestroYa executed a refund (Module 153, with a refund record);
 * a lost chargeback is the card network taking the money back, so no such record exists. Both are terminal and both deny access.
 */

/** Dispute statuses MaestroYa tracks. NEEDS_RESPONSE and UNDER_REVIEW are "open"; the other three are terminal. */
export const LEAD_FEE_DISPUTE_STATUSES = ["NEEDS_RESPONSE", "UNDER_REVIEW", "WON", "LOST", "WARNING_CLOSED"] as const;
export type LeadFeeDisputeStatus = (typeof LEAD_FEE_DISPUTE_STATUSES)[number];

export const LEAD_FEE_DISPUTE_OPEN_STATUSES = ["NEEDS_RESPONSE", "UNDER_REVIEW"] as const satisfies readonly LeadFeeDisputeStatus[];

export function isLeadFeeDisputeStatus(value: unknown): value is LeadFeeDisputeStatus {
  return typeof value === "string" && (LEAD_FEE_DISPUTE_STATUSES as readonly string[]).includes(value);
}

export function isOpenLeadFeeDisputeStatus(status: LeadFeeDisputeStatus): boolean {
  return (LEAD_FEE_DISPUTE_OPEN_STATUSES as readonly string[]).includes(status);
}

/**
 * Mirrors the DB trigger `lead_fee_disputes_guard_update`. Forward-only: an out-of-order or replayed event can never move a
 * dispute backwards, and the three terminal statuses are absorbing.
 */
export const LEAD_FEE_DISPUTE_TRANSITIONS: Readonly<Record<LeadFeeDisputeStatus, readonly LeadFeeDisputeStatus[]>> = {
  NEEDS_RESPONSE: ["UNDER_REVIEW", "WON", "LOST", "WARNING_CLOSED"],
  UNDER_REVIEW: ["WON", "LOST", "WARNING_CLOSED"],
  WON: [],
  LOST: [],
  WARNING_CLOSED: [],
};

export function canTransitionLeadFeeDispute(from: LeadFeeDisputeStatus, to: LeadFeeDisputeStatus): boolean {
  return LEAD_FEE_DISPUTE_TRANSITIONS[from].includes(to);
}

export const LEAD_FEE_DISPUTE_CURRENCY = "EUR";

// ---------------------------------------------------------------- provider events

/** The only dispute event types MaestroYa acts on (the verifier adapter already limits the stream to these). */
export const LEAD_FEE_DISPUTE_EVENT_TYPES = ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"] as const;
export type LeadFeeDisputeEventType = (typeof LEAD_FEE_DISPUTE_EVENT_TYPES)[number];

export function isLeadFeeDisputeEventType(value: unknown): value is LeadFeeDisputeEventType {
  return typeof value === "string" && (LEAD_FEE_DISPUTE_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Maps the provider's RAW dispute status to MaestroYa's. Nothing is guessed:
 *  - `created` / `updated` carry an OPEN status (needs_response, under_review, and the early-warning variants of both,
 *    which are treated as open exactly like the legacy dispute module does);
 *  - `closed` carries a final status (won, lost, warning_closed);
 *  - anything else — an unknown status, or a final status on an open event and vice versa — returns null and the event is
 *    REJECTED without changing any state (fail closed; it is logged for an operator).
 */
export function mapProviderDisputeStatus(eventType: LeadFeeDisputeEventType, rawStatus: string): LeadFeeDisputeStatus | null {
  if (eventType === "charge.dispute.closed") {
    if (rawStatus === "won") return "WON";
    if (rawStatus === "lost") return "LOST";
    if (rawStatus === "warning_closed") return "WARNING_CLOSED";
    return null;
  }
  if (rawStatus === "needs_response" || rawStatus === "warning_needs_response") return "NEEDS_RESPONSE";
  if (rawStatus === "under_review" || rawStatus === "warning_under_review") return "UNDER_REVIEW";
  return null;
}

export type LeadFeeDisputeEventRejection =
  | "UNSUPPORTED_EVENT"
  | "PAYMENT_REFERENCE_MISSING"
  | "NOT_LEAD_V1"
  | "SNAPSHOT_INVALID"
  | "CURRENCY_MISMATCH"
  | "AMOUNT_INVALID"
  | "AMOUNT_EXCEEDS_PAYMENT"
  | "CHARGE_MISSING"
  | "STATUS_UNRECOGNIZED"
  | "ASSOCIATION_CONFLICT";

export class LeadFeeDisputeRejectedError extends DomainError {
  readonly code = "LEAD_FEE_DISPUTE_REJECTED";

  constructor(readonly reason: LeadFeeDisputeEventRejection | LeadFeeDisputeAdminRejection) {
    super("The lead-fee dispute request was rejected.");
  }
}

// ---------------------------------------------------------------- the purchase effect of a dispute status

export type LeadFeeDisputePurchaseEffect =
  | "SUSPEND" // CONFIRMED -> DISPUTED
  | "RESTORE" // DISPUTED -> CONFIRMED
  | "REVOKE" // CONFIRMED | DISPUTED -> REVOKED
  | "REFUND" // DISPUTED -> REFUNDED (the dispute no longer holds the purchase and a PLATFORM_ERROR refund already SUCCEEDED)
  | "NONE";

/**
 * The state of the purchase's PLATFORM_ERROR refund attempts (Module 153), reduced to what a dispute outcome may rely on.
 * Only explicitly known M153 statuses are interpreted; an unrecognised one is `UNRECOGNIZED` and fails SAFE (access stays denied).
 * FAILED attempts are explicitly irrelevant (the refund did not happen); DUPLICATE_CHARGE attempts are never passed in.
 */
export type LeadFeePlatformRefundState = "NONE" | "IN_FLIGHT" | "SUCCEEDED" | "UNRECOGNIZED";

export function summarizePlatformRefundState(statuses: readonly string[]): LeadFeePlatformRefundState {
  if (statuses.includes("SUCCEEDED")) return "SUCCEEDED";
  if (statuses.some((s) => s === "REQUESTED" || s === "PROVIDER_PENDING" || s === "UNKNOWN")) return "IN_FLIGHT";
  if (statuses.some((s) => s !== "FAILED")) return "UNRECOGNIZED";
  return "NONE";
}

/**
 * What a dispute that is NOW in `disputeStatus` requires of a purchase that is NOW in `purchaseStatus`. Pure and total, so the
 * same function serves a live event, a replay, an out-of-order delivery and the "payment confirmed after the dispute arrived"
 * reconciliation: the answer depends only on the two current states, never on the order the events arrived in.
 *
 *  - open dispute: CONFIRMED is suspended; DISPUTED stays; every other status is left alone (REFUNDED / REVOKED are already
 *    terminal and deny access; PENDING_PAYMENT is reconciled when its payment is confirmed; FAILED / CANCELLED never granted access);
 *  - WON / WARNING_CLOSED: only a DISPUTED purchase is restored (CONFIRMED needs nothing; terminal ones stay terminal);
 *  - LOST: a CONFIRMED or DISPUTED purchase is revoked; a terminal one is left as it is.
 * (The refund-aware restore rule lives in `decideLeadFeeDisputesPurchaseEffect`.)
 */
export function decideLeadFeeDisputePurchaseEffect(
  disputeStatus: LeadFeeDisputeStatus,
  purchaseStatus: LeadPurchaseStatus,
): LeadFeeDisputePurchaseEffect {
  switch (disputeStatus) {
    case "NEEDS_RESPONSE":
    case "UNDER_REVIEW":
      return purchaseStatus === "CONFIRMED" ? "SUSPEND" : "NONE";
    case "WON":
    case "WARNING_CLOSED":
      return purchaseStatus === "DISPUTED" ? "RESTORE" : "NONE";
    case "LOST":
      return purchaseStatus === "CONFIRMED" || purchaseStatus === "DISPUTED" ? "REVOKE" : "NONE";
  }
}

/**
 * The effect required by ALL disputes recorded for one purchase (a purchase normally has one, but the rule must not depend on it).
 * Priority: a LOST dispute revokes; otherwise any OPEN dispute suspends; otherwise (every dispute is WON / WARNING_CLOSED) a
 * suspended purchase is restored. No recorded dispute requires nothing. Pure and order-independent.
 */
export function decideLeadFeeDisputesPurchaseEffect(
  purchaseStatus: LeadPurchaseStatus,
  disputeStatuses: readonly LeadFeeDisputeStatus[],
  refund: LeadFeePlatformRefundState = "NONE",
): LeadFeeDisputePurchaseEffect {
  if (disputeStatuses.length === 0) return "NONE";
  if (disputeStatuses.includes("LOST")) return decideLeadFeeDisputePurchaseEffect("LOST", purchaseStatus);
  const open = disputeStatuses.find(isOpenLeadFeeDisputeStatus);
  if (open) return decideLeadFeeDisputePurchaseEffect(open, purchaseStatus);
  const restore = decideLeadFeeDisputePurchaseEffect("WON", purchaseStatus);
  if (restore !== "RESTORE") return restore;
  // Module 155 H1: no dispute holds the purchase any more, but a PLATFORM_ERROR refund decides what it may become. Contact access
  // is NEVER restored while a refund succeeded or may still succeed: a succeeded refund converges to REFUNDED, an in-flight / uncertain
  // / unrecognised one keeps the purchase DISPUTED (access denied) until it is settled.
  switch (refund) {
    case "NONE":
      return "RESTORE";
    case "SUCCEEDED":
      return "REFUND";
    case "IN_FLIGHT":
    case "UNRECOGNIZED":
      return "NONE";
  }
}

export function purchaseStatusAfterEffect(effect: LeadFeeDisputePurchaseEffect, current: LeadPurchaseStatus): LeadPurchaseStatus {
  switch (effect) {
    case "SUSPEND":
      return "DISPUTED";
    case "RESTORE":
      return "CONFIRMED";
    case "REVOKE":
      return "REVOKED";
    case "REFUND":
      return "REFUNDED";
    case "NONE":
      return current;
  }
}

// ---------------------------------------------------------------- association / money checks

/** Facts of the persisted purchase that a dispute is validated against. */
export interface LeadFeeDisputePurchaseFacts {
  status: LeadPurchaseStatus;
  paymentReference: string | null;
  currency: string;
  /** Exact decimal string of the snapshot total (what the professional paid), or null for a pre-M136 purchase. */
  totalAmount: string | null;
}

/** A dispute as the provider reports it, reduced to what MaestroYa stores. Provider ids are opaque. */
export interface LeadFeeProviderDisputeFacts {
  providerDisputeId: string;
  paymentReference: string | null;
  providerChargeId: string | null;
  amountMinorUnits: number | null;
  currency: string;
  reason: string | null;
  evidenceDueBy: Date | null;
}

/** "12.34" -> 1234, exactly, without floating point. Returns null for anything that is not a non-negative 2-decimal amount. */
export function decimalToMinorUnits(amount: string): number | null {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

export function minorUnitsToDecimal(minorUnits: number): string {
  const negative = minorUnits < 0;
  const abs = Math.abs(minorUnits);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

/**
 * Validates a provider dispute against the persisted purchase it was correlated to (by the write-once payment reference).
 * Returns the rejection reason, or null when the dispute is consistent. The amount may be LESS than the payment (a partial
 * dispute) but never more; it is never read from anywhere but the signature-verified event.
 */
export function validateLeadFeeDisputeAgainstPurchase(
  dispute: LeadFeeProviderDisputeFacts,
  purchase: LeadFeeDisputePurchaseFacts,
): LeadFeeDisputeEventRejection | null {
  if (!dispute.paymentReference || purchase.paymentReference !== dispute.paymentReference) return "PAYMENT_REFERENCE_MISSING";
  if (!dispute.providerChargeId) return "CHARGE_MISSING";
  if (purchase.currency !== LEAD_FEE_DISPUTE_CURRENCY || dispute.currency.toUpperCase() !== LEAD_FEE_DISPUTE_CURRENCY) return "CURRENCY_MISMATCH";
  if (purchase.totalAmount === null) return "SNAPSHOT_INVALID";
  const total = decimalToMinorUnits(purchase.totalAmount);
  if (total === null || total <= 0) return "SNAPSHOT_INVALID";
  const amount = dispute.amountMinorUnits;
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) return "AMOUNT_INVALID";
  if (amount > total) return "AMOUNT_EXCEEDS_PAYMENT";
  return null;
}

// ---------------------------------------------------------------- administrative revocation + evidence (admin inputs)

export type LeadFeeDisputeAdminRejection =
  | "INVALID_INPUT"
  | "SWITCH_DISABLED"
  | "CONFIG_INVALID"
  | "ACTOR_NOT_AUTHORIZED"
  | "PURCHASE_NOT_FOUND"
  | "PURCHASE_NOT_CONFIRMED"
  | "DISPUTE_NOT_FOUND"
  | "DISPUTE_NOT_OPEN"
  | "EVIDENCE_NOT_ALLOWED"
  | "PROVIDER_MISMATCH"
  | "PROVIDER_UNAVAILABLE";

/** Roles allowed to revoke access / submit evidence. A LOCAL constant (the application layer must not import infrastructure RBAC); a unit test pins it to the real ROLES. */
export const LEAD_FEE_DISPUTE_ALLOWED_ACTOR_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
export const LEAD_FEE_DISPUTE_ACTOR_ACTIVE_STATUS = "ACTIVE";

// ---------------------------------------------------------------- evidence submission state + switch

export const LEAD_FEE_DISPUTE_EVIDENCE_STATUSES = ["NOT_SUBMITTED", "SUBMISSION_PENDING", "SUBMITTED"] as const;
export type LeadFeeDisputeEvidenceStatus = (typeof LEAD_FEE_DISPUTE_EVIDENCE_STATUSES)[number];

/** Mirrors the DB trigger. SUBMISSION_PENDING -> NOT_SUBMITTED is the controlled retry after a DEFINITIVE provider rejection. */
export const LEAD_FEE_DISPUTE_EVIDENCE_TRANSITIONS: Readonly<Record<LeadFeeDisputeEvidenceStatus, readonly LeadFeeDisputeEvidenceStatus[]>> = {
  NOT_SUBMITTED: ["SUBMISSION_PENDING"],
  SUBMISSION_PENDING: ["SUBMITTED", "NOT_SUBMITTED"],
  SUBMITTED: [],
};

export const LEAD_FEE_DISPUTE_EVIDENCE_ENV = "LEAD_FEE_DISPUTE_EVIDENCE_SUBMISSION_ENABLED";

export type LeadFeeDisputeEvidenceConfig = { status: "VALID"; submissionEnabled: boolean } | { status: "INVALID" };

/** Evidence submission is a real, irreversible provider write: OFF unless the variable is EXACTLY "true". Any other non-empty value blocks (invalid). */
export function resolveLeadFeeDisputeEvidenceConfig(env: Readonly<Record<string, string | undefined>>): LeadFeeDisputeEvidenceConfig {
  const raw = env[LEAD_FEE_DISPUTE_EVIDENCE_ENV];
  if (raw === undefined) return { status: "VALID", submissionEnabled: false };
  const value = raw.trim();
  if (value === "" || value === "false") return { status: "VALID", submissionEnabled: false };
  if (value === "true") return { status: "VALID", submissionEnabled: true };
  return { status: "INVALID" };
}

/** Deterministic per dispute: a retried provider call converges on the same request (the provider accepts a submission once). */
export function leadFeeDisputeEvidenceIdempotencyKey(disputeId: string): string {
  return `lead-fee-dispute-evidence:${disputeId}`;
}

/** What the provider says about a dispute right now (read before any evidence is sent). */
export interface LeadFeeProviderDisputeState {
  providerDisputeId: string;
  paymentReference: string | null;
  /** Provider's raw status string, never interpreted outside `mapProviderDisputeStatus`. */
  rawStatus: string;
  amountMinorUnits: number;
  currency: string;
  evidenceDueBy: Date | null;
  pastDue: boolean;
  /** How many times evidence was already submitted at the provider (a submission is final). */
  evidenceSubmissionCount: number;
}
