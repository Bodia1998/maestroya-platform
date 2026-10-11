import { DomainError } from "@/domain/errors/domain-error";
import type { RecordAdminAuditLogData } from "@/domain/repositories/admin-audit-log-repository";
import type {
  LeadQualityClaimDecision,
  LeadQualityClaimReasonCode,
  LeadQualityClaimStatus,
} from "@/domain/services/lead-quality-claim";

/**
 * Module 154 (Part A) — persistence port of lead-quality claims (table `lead_quality_claims`). A claim has NO financial
 * field. Rows are never deleted; identity/content is immutable; status moves are conditional on the expected current status.
 */
export interface LeadQualityClaimRecord {
  id: string;
  leadPurchaseId: string;
  professionalProfileId: string;
  reasonCode: LeadQualityClaimReasonCode;
  status: LeadQualityClaimStatus;
  description: string;
  evidenceReference: string | null;
  submittedAt: Date;
  /** Response target (submittedAt + 72h), not a deadline for an automatic decision. */
  respondBy: Date;
  reviewStartedAt: Date | null;
  reviewStartedByUserId: string | null;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  decisionExplanation: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What the caller chooses. `submittedAt` and `respondBy` are deliberately NOT part of it: the DATABASE stamps `submittedAt` from its own
 * clock (the claim window is decided against that same instant) and derives `respondBy = submittedAt + 72h`.
 */
export interface LeadQualityClaimDraft {
  leadPurchaseId: string;
  professionalProfileId: string;
  reasonCode: LeadQualityClaimReasonCode;
  description: string;
  evidenceReference: string | null;
}

export type LeadQualityClaimAuditAction = Extract<RecordAdminAuditLogData["action"], `LEAD_QUALITY_CLAIM_${string}`>;

/**
 * The ONE audit entry written for a claim transition. Ids, the reason code and the status change only: never the claim description,
 * the decision explanation or any contact data. Shared by the Prisma adapter and the test double so both write the same entry.
 */
export function buildLeadQualityClaimAuditEntry(
  action: LeadQualityClaimAuditAction,
  actorUserId: string,
  claim: Pick<LeadQualityClaimRecord, "id" | "leadPurchaseId" | "professionalProfileId" | "reasonCode" | "status">,
  fromStatus: LeadQualityClaimStatus | null,
): RecordAdminAuditLogData {
  return {
    adminUserId: actorUserId,
    action,
    targetType: "LeadQualityClaim",
    targetId: claim.id,
    metadata: {
      leadPurchaseId: claim.leadPurchaseId,
      professionalProfileId: claim.professionalProfileId,
      reasonCode: claim.reasonCode,
      fromStatus,
      toStatus: claim.status,
    },
  };
}

export type LeadQualityClaimConflictReason =
  | "ALREADY_CLAIMED"
  | "OPEN_CLAIM_LIMIT_REACHED"
  | "PERIOD_CLAIM_LIMIT_REACHED"
  | "CLAIM_WINDOW_CLOSED"
  | "PURCHASE_NOT_CLAIMABLE";

/** The database (unique index / insert trigger) refused the insert: the authoritative answer under concurrency. */
export class LeadQualityClaimInsertConflictError extends DomainError {
  readonly code = "LEAD_QUALITY_CLAIM_INSERT_CONFLICT";

  constructor(readonly reason: LeadQualityClaimConflictReason) {
    super(`Lead quality claim could not be recorded: ${reason}.`);
  }
}

/**
 * ATOMICITY (H1): `create`, `markReviewStarted` and `decide` each write the claim change AND its append-only audit entry in ONE
 * database transaction. If the audit insert fails, the claim change is rolled back and the error propagates to the caller.
 */
export interface LeadQualityClaimRepository {
  findById(id: string): Promise<LeadQualityClaimRecord | null>;
  findByLeadPurchaseId(leadPurchaseId: string): Promise<LeadQualityClaimRecord | null>;
  /** Claims of the professional that are SUBMITTED or UNDER_REVIEW. */
  countOpenByProfessional(professionalProfileId: string): Promise<number>;
  /** Claims of the professional (any status) submitted strictly after `since`. */
  countSubmittedSince(professionalProfileId: string, since: Date): Promise<number>;
  /**
   * Separation of duties (M2): whether the claim's professional profile, as PERSISTED, belongs to `userId`. `false` for an unknown claim.
   */
  isClaimOwnedByUser(claimId: string, userId: string): Promise<boolean>;
  /**
   * Inserts a SUBMITTED claim together with its SUBMITTED audit entry (actor = the claiming user). The database decides `submittedAt`
   * and `respondBy` and whether the 72-hour window is open. Throws LeadQualityClaimInsertConflictError when the database refuses it.
   */
  create(draft: LeadQualityClaimDraft, actorUserId: string): Promise<LeadQualityClaimRecord>;
  /** SUBMITTED -> UNDER_REVIEW (+ audit), only if the row is still SUBMITTED. `null` when it was not (missing or a concurrent move won). */
  markReviewStarted(id: string, actorUserId: string, at: Date): Promise<LeadQualityClaimRecord | null>;
  /** SUBMITTED | UNDER_REVIEW -> APPROVED | REJECTED (+ audit), only if the row is still open. `null` when it was not. Exactly one decision can win. */
  decide(
    id: string,
    decision: { to: LeadQualityClaimDecision; actorUserId: string; explanation: string; at: Date },
  ): Promise<LeadQualityClaimRecord | null>;
}
