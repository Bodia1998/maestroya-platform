import { DomainError } from "@/domain/errors/domain-error";
import { LEAD_STATUSES, type LeadStatus } from "@/domain/services/lead";

/**
 * Module 157 — Lead Admin Operations Console: pure rules of the READ side.
 *
 * The console adds NO business rule of M154 (claims), M155 (disputes / revocation) or M156 (fraud & abuse): their use cases stay the
 * only way to change their state. This file only holds what the console itself decides: who may read, how a page is bounded, and how
 * recorded facts are told apart from derived indicators on the investigation timeline.
 *
 * PRIVACY (roadmap decision D26 — default "no contact display"): nothing here, nor any record built from it, carries a customer or
 * professional name, e-mail, phone, address line or request text. Parties appear as opaque ids only.
 */

/** Administrators allowed to use the console. Same pair as the M154/M155/M156 use cases (SUPPORT is deliberately not included). */
export const LEAD_ADMIN_CONSOLE_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
export const LEAD_ADMIN_CONSOLE_ACTIVE_STATUS = "ACTIVE";

export const LEAD_ADMIN_DEFAULT_PAGE_SIZE = 20;
export const LEAD_ADMIN_MAX_PAGE_SIZE = 100;
/** Hard bound on a deep offset, so a crafted page number cannot force a huge scan. */
export const LEAD_ADMIN_MAX_OFFSET = 10_000;
/** Hard bound on every list attached to a detail view (purchases of one lead, audit entries, signals ...). */
export const LEAD_ADMIN_DETAIL_ROW_CAP = 200;
export const LEAD_ADMIN_MAX_SEARCH_LENGTH = 100;

export type LeadAdminConsoleRejection = "ACTOR_NOT_AUTHORIZED" | "INVALID_INPUT" | "LEAD_NOT_FOUND" | "SUBJECT_NOT_FOUND";

/** Closed reason set; the message never echoes input. */
export class LeadAdminConsoleRejectedError extends DomainError {
  readonly code = "LEAD_ADMIN_CONSOLE_REJECTED";

  constructor(readonly reason: LeadAdminConsoleRejection) {
    super(`Lead admin console request rejected: ${reason}.`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeadAdminUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

/** A trimmed uuid; anything else is INVALID_INPUT. */
export function normalizeLeadAdminUuid(value: unknown): string {
  if (!isLeadAdminUuid(value)) throw new LeadAdminConsoleRejectedError("INVALID_INPUT");
  return (value as string).trim().toLowerCase();
}

export interface LeadAdminPage {
  limit: number;
  offset: number;
}

/** Bounded, integer-only paging. Missing -> defaults; anything malformed or out of range -> INVALID_INPUT (never silently widened). */
export function normalizeLeadAdminPage(input: { limit?: unknown; offset?: unknown } | undefined): LeadAdminPage {
  const limit = input?.limit ?? LEAD_ADMIN_DEFAULT_PAGE_SIZE;
  const offset = input?.offset ?? 0;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > LEAD_ADMIN_MAX_PAGE_SIZE) {
    throw new LeadAdminConsoleRejectedError("INVALID_INPUT");
  }
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > LEAD_ADMIN_MAX_OFFSET) {
    throw new LeadAdminConsoleRejectedError("INVALID_INPUT");
  }
  return { limit, offset };
}

export function isLeadAdminLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

/** A short, control-character-free filter string (province / city). Empty -> undefined. */
export function normalizeLeadAdminSearchText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new LeadAdminConsoleRejectedError("INVALID_INPUT");
  const text = value.trim();
  if (text === "") return undefined;
  if (text.length > LEAD_ADMIN_MAX_SEARCH_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) throw new LeadAdminConsoleRejectedError("INVALID_INPUT");
  return text;
}

/** An optional date; invalid dates are INVALID_INPUT. */
export function normalizeLeadAdminDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new LeadAdminConsoleRejectedError("INVALID_INPUT");
  return date;
}

// ---------------------------------------------------------------- timeline: facts versus derived indicators

/**
 * How trustworthy a line of the investigation view is.
 *  - RECORDED_FACT: a timestamp / status persisted by a domain table (the source of truth of M154/M155).
 *  - AUDIT_ENTRY: a row of the append-only audit trail (who did it, from which status to which).
 *  - DERIVED: computed by the console from facts at read time, never persisted ("overdue", "all slots taken").
 *  - HEURISTIC_SIGNAL: an M156 signal that is a volume pattern a legitimate user could also produce. NOT proof of abuse.
 */
export type LeadAdminEvidenceBasis = "RECORDED_FACT" | "AUDIT_ENTRY" | "DERIVED" | "HEURISTIC_SIGNAL";

export type LeadAdminTimelineSubject = "LEAD" | "PURCHASE" | "CLAIM" | "DISPUTE" | "REVOCATION" | "ABUSE_SIGNAL" | "AUDIT";

export interface LeadAdminTimelineEvent {
  at: Date;
  basis: LeadAdminEvidenceBasis;
  subject: LeadAdminTimelineSubject;
  /** Stable machine code (translated by the UI), e.g. "PURCHASE_CONFIRMED". */
  code: string;
  /** The row the event belongs to (purchase / claim / dispute / revocation / signal / audit id). */
  refId: string;
  /** Opaque user id of the actor when the source records one. */
  actorUserId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
}

const SUBJECT_ORDER: Record<LeadAdminTimelineSubject, number> = { LEAD: 0, PURCHASE: 1, DISPUTE: 2, REVOCATION: 3, CLAIM: 4, ABUSE_SIGNAL: 5, AUDIT: 6 };

/** Oldest first; ties broken by subject, then code, then id, so the same facts always render in the same order. */
export function sortLeadAdminTimeline(events: readonly LeadAdminTimelineEvent[]): LeadAdminTimelineEvent[] {
  return [...events].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      SUBJECT_ORDER[a.subject] - SUBJECT_ORDER[b.subject] ||
      a.code.localeCompare(b.code) ||
      a.refId.localeCompare(b.refId),
  );
}

export interface LeadAdminIndicator {
  code: "CLAIM_RESPONSE_TARGET_PASSED" | "DISPUTE_EVIDENCE_DUE_PASSED" | "BUYER_CAPACITY_REACHED" | "ACCESS_SUSPENDED_BY_DISPUTE";
  basis: "DERIVED";
  refId: string;
}

export interface LeadAdminIndicatorInput {
  now: Date;
  maxBuyers: number | null;
  purchases: ReadonlyArray<{ id: string; status: string }>;
  claims: ReadonlyArray<{ id: string; status: string; respondBy: Date }>;
  disputes: ReadonlyArray<{ id: string; status: string; evidenceDueBy: Date | null; evidenceStatus: string }>;
}

const OPEN_CLAIM = new Set(["SUBMITTED", "UNDER_REVIEW"]);
const OPEN_DISPUTE = new Set(["NEEDS_RESPONSE", "UNDER_REVIEW"]);
/** Purchases that occupy a buyer slot (the same set M155 documents as "active"). */
const SLOT_HOLDING = new Set(["PENDING_PAYMENT", "CONFIRMED", "DISPUTED"]);

/**
 * Indicators the console DERIVES for the reader. They are read-time computations over persisted facts and are labelled DERIVED in the
 * UI; none of them is stored, none changes state, and none is a decision (a passed response target is never an automatic decision).
 */
export function deriveLeadAdminIndicators(input: LeadAdminIndicatorInput): LeadAdminIndicator[] {
  const out: LeadAdminIndicator[] = [];
  const now = input.now.getTime();
  for (const claim of input.claims) {
    if (OPEN_CLAIM.has(claim.status) && claim.respondBy.getTime() < now) out.push({ code: "CLAIM_RESPONSE_TARGET_PASSED", basis: "DERIVED", refId: claim.id });
  }
  for (const dispute of input.disputes) {
    if (OPEN_DISPUTE.has(dispute.status) && dispute.evidenceStatus === "NOT_SUBMITTED" && dispute.evidenceDueBy && dispute.evidenceDueBy.getTime() < now) {
      out.push({ code: "DISPUTE_EVIDENCE_DUE_PASSED", basis: "DERIVED", refId: dispute.id });
    }
  }
  for (const purchase of input.purchases) {
    if (purchase.status === "DISPUTED") out.push({ code: "ACCESS_SUSPENDED_BY_DISPUTE", basis: "DERIVED", refId: purchase.id });
  }
  if (input.maxBuyers !== null && input.purchases.filter((p) => SLOT_HOLDING.has(p.status)).length >= input.maxBuyers) {
    out.push({ code: "BUYER_CAPACITY_REACHED", basis: "DERIVED", refId: "lead" });
  }
  return out;
}

/** Signals that are evidence only: they never flag, block or change anything by themselves (M156). Shown with an explicit label. */
export const LEAD_ADMIN_RECORD_ONLY_SIGNAL_TYPES = ["PURCHASE_REJECTED_PROBING", "PURCHASE_REJECTED_EVENT"] as const;

export function isLeadAdminRecordOnlySignal(signalType: string): boolean {
  return (LEAD_ADMIN_RECORD_ONLY_SIGNAL_TYPES as readonly string[]).includes(signalType);
}
