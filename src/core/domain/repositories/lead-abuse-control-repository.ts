import type {
  LeadAbuseDecisionAction,
  LeadAbuseDecisionOrigin,
  LeadAbuseDecisionStatus,
  LeadAbuseEventSignalType,
  LeadAbuseReliability,
  LeadAbuseRestrictedAction,
  LeadAbuseRuleKey,
  LeadAbuseSeverity,
  LeadAbuseSignalType,
} from "@/domain/services/lead-abuse-controls";
import type { RecordAdminAuditLogData } from "@/domain/repositories/admin-audit-log-repository";

/**
 * Module 156 — ports of the lead fraud & abuse controls.
 *
 * `LeadAbuseFactsReader` is READ-ONLY and may look at disputes, revocations, purchases and leads, but only ever COUNTS them: it
 * cannot modify a purchase, a dispute or a revocation (M155 owns those), and it returns numbers, never contact data.
 *
 * `LeadAbuseControlRepository` owns the two new tables. Every method that creates or changes a DECISION writes its append-only
 * audit entry in the SAME database transaction (a failing audit insert rolls the decision back, as in M154/M155).
 */

export interface LeadAbuseFactsReader {
  /** LEAD_V1 leads the customer (by USER id) published at or after `since`. */
  countPublicationsByCustomer(userId: string, since: Date): Promise<number>;
  /** The largest group of the customer's live LEAD_V1 requests created at or after `since` whose normalised title+description are identical. */
  maxIdenticalRequestGroupByCustomer(userId: string, since: Date): Promise<number>;
  /** Lead purchases the professional (by USER id) created at or after `since`, whatever their status. */
  countPurchaseInitiationsByProfessional(userId: string, since: Date): Promise<number>;
  /** Distinct lead ids of the subject's raw event signals of `type` at or after `since`. */
  countDistinctEventLeads(userId: string, type: LeadAbuseEventSignalType, since: Date): Promise<number>;
  /** Provider disputes opened (any outcome) on the professional's purchases at or after `since` (read-only over M155 rows). */
  countDisputesOpenedByProfessional(userId: string, since: Date): Promise<number>;
  /** Provider disputes of the professional that were closed LOST at or after `since` (read-only). */
  countDisputesLostByProfessional(userId: string, since: Date): Promise<number>;
  /** Purchase revocations (administrative or dispute-lost) of the professional's purchases at or after `since` (read-only). */
  countRevocationsByProfessional(userId: string, since: Date): Promise<number>;
}

export interface LeadAbuseSignalDraft {
  subjectUserId: string;
  signalType: LeadAbuseSignalType;
  reliability: LeadAbuseReliability;
  severity: LeadAbuseSeverity;
  ruleVersion: string;
  /** UNIQUE: the idempotency key. Recording the same key twice is a no-op. */
  dedupeKey: string;
  /** Required for raw event signals (the lead that was probed); null for rule hits. */
  targetLeadId: string | null;
  observedCount: number | null;
  threshold: number | null;
  windowSeconds: number | null;
  occurredAt: Date;
}

export interface LeadAbuseDecisionRecord {
  id: string;
  subjectUserId: string;
  action: LeadAbuseDecisionAction;
  restrictedAction: LeadAbuseRestrictedAction | null;
  status: LeadAbuseDecisionStatus;
  origin: LeadAbuseDecisionOrigin;
  ruleKey: LeadAbuseRuleKey | null;
  ruleVersion: string | null;
  reasonCode: string;
  createdByUserId: string | null;
  decidedAt: Date;
  expiresAt: Date | null;
  explanation: string | null;
  liftedAt: Date | null;
  liftedByUserId: string | null;
  resolutionNote: string | null;
}

export interface AutomatedLeadAbuseDecisionDraft {
  subjectUserId: string;
  action: LeadAbuseDecisionAction;
  restrictedAction: LeadAbuseRestrictedAction | null;
  ruleKey: LeadAbuseRuleKey;
  ruleVersion: string;
  /** Required for a block (never null, never beyond the 24 h cap); null for a flag. */
  expiresAt: Date | null;
  decidedAt: Date;
  observedCount: number;
  threshold: number;
}

export interface AdminLeadAbuseBlockDraft {
  subjectUserId: string;
  restrictedAction: LeadAbuseRestrictedAction;
  actorUserId: string;
  explanation: string;
  decidedAt: Date;
  expiresAt: Date;
}

export interface LeadAbuseDecisionOutcome {
  decision: LeadAbuseDecisionRecord;
  /** False when an ACTIVE decision of the same kind already existed and was returned unchanged (idempotent / lost race). */
  created: boolean;
}

export interface LeadAbuseControlRepository {
  /** Idempotent by `dedupeKey`. Returns true when THIS call inserted the row. */
  recordSignal(draft: LeadAbuseSignalDraft): Promise<boolean>;

  /** The ACTIVE, unexpired block of `action` for the subject, or null. Expired rows are not returned (expiry is evaluated against `now`). */
  findBlockInForce(subjectUserId: string, action: LeadAbuseRestrictedAction, now: Date): Promise<LeadAbuseDecisionRecord | null>;

  findDecisionById(id: string): Promise<LeadAbuseDecisionRecord | null>;

  /** ACTIVE decisions (flags and unexpired blocks) of one subject, newest first. */
  listActiveForSubject(subjectUserId: string, now: Date): Promise<LeadAbuseDecisionRecord[]>;

  /** The review queue: ACTIVE FLAG_FOR_REVIEW decisions, oldest first. */
  listOpenFlags(limit: number): Promise<LeadAbuseDecisionRecord[]>;

  /**
   * Creates the automated flag / temporary block, or returns the ACTIVE one that already exists (partial unique index, so two
   * concurrent callers get ONE row). Expired blocks of the same kind are first moved to EXPIRED. The audit entry is written in the
   * same transaction, and only by the caller that created the row.
   */
  applyAutomatedDecision(draft: AutomatedLeadAbuseDecisionDraft): Promise<LeadAbuseDecisionOutcome>;

  /** Administrator block; same idempotency / expiry handling and the same atomic audit entry. */
  imposeAdminBlock(draft: AdminLeadAbuseBlockDraft): Promise<LeadAbuseDecisionOutcome>;

  /**
   * ACTIVE -> LIFTED (a block is lifted, a flag is resolved), with the actor and a note, in one transaction with its audit entry.
   * Returns null when the decision is not ACTIVE any more (a concurrent lift won): exactly one caller succeeds.
   */
  lift(id: string, actorUserId: string, note: string, at: Date): Promise<LeadAbuseDecisionRecord | null>;
}

/** Audit entry of a decision transition: ids, action names and statuses only — never the explanation / note text. */
export function buildLeadAbuseAuditEntry(
  action: "LEAD_ABUSE_FLAGGED" | "LEAD_ABUSE_BLOCK_APPLIED" | "LEAD_ABUSE_DECISION_LIFTED",
  actorUserId: string | null,
  decision: Pick<LeadAbuseDecisionRecord, "id" | "subjectUserId" | "action" | "restrictedAction" | "origin" | "ruleKey" | "ruleVersion" | "status" | "expiresAt">,
  fromStatus: LeadAbuseDecisionStatus | null,
): RecordAdminAuditLogData {
  return {
    adminUserId: actorUserId,
    action,
    targetType: "LeadAbuseDecision",
    targetId: decision.id,
    metadata: {
      subjectUserId: decision.subjectUserId,
      decisionAction: decision.action,
      restrictedAction: decision.restrictedAction,
      origin: decision.origin,
      ruleKey: decision.ruleKey,
      ruleVersion: decision.ruleVersion,
      fromStatus,
      toStatus: decision.status,
      expiresAt: decision.expiresAt ? decision.expiresAt.toISOString() : null,
    },
  };
}
