import type {
  LeadFeeDisputeEvidenceStatus,
  LeadFeeDisputePurchaseEffect,
  LeadFeeDisputeStatus,
  LeadFeeProviderDisputeFacts,
} from "@/domain/services/lead-fee-dispute";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 155 — persistence port for lead-fee disputes (chargebacks) and the administrative revocation of a purchase.
 *
 * Every write that changes a dispute AND/OR its purchase is ONE atomic unit with its append-only audit entry: either the
 * dispute record, the purchase transition, the revocation record and the audit entries are all committed, or none is. There
 * is no state in which a purchase is DISPUTED without a recorded open dispute (a database trigger enforces that too).
 */
export interface LeadFeeDisputeRecord {
  id: string;
  providerDisputeId: string;
  leadPurchaseId: string;
  /** The provider payment the dispute is about; equals the purchase's persisted payment reference. */
  paymentReference: string;
  providerChargeId: string;
  status: LeadFeeDisputeStatus;
  /** Exact decimal string (EUR). May be less than the payment (partial dispute), never more. */
  amount: string;
  currency: string;
  /** The provider's dispute reason string (observability only). */
  reason: string | null;
  evidenceDueBy: Date | null;
  openedAt: Date;
  /** Set once, when a terminal status is recorded. */
  closedAt: Date | null;
  lastProviderEventId: string;
  lastProviderEventAt: Date;
  evidenceStatus: LeadFeeDisputeEvidenceStatus;
  evidenceReference: string | null;
  /** The text claimed for submission; never copied into an audit entry. */
  evidenceText: string | null;
  evidenceActorUserId: string | null;
  evidenceRequestedAt: Date | null;
  evidenceSubmittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A provider dispute event, already signature-verified AND validated against the purchase by the use case. */
export interface ApplyLeadFeeDisputeEventCommand {
  leadPurchaseId: string;
  providerEventId: string;
  providerEventAt: Date;
  status: LeadFeeDisputeStatus;
  dispute: LeadFeeProviderDisputeFacts;
  /** Application clock for the purchase's own lifecycle stamp (revokedAt). */
  now: Date;
}

export interface ApplyLeadFeeDisputeEventResult {
  dispute: LeadFeeDisputeRecord;
  /** True when this call inserted the dispute record. */
  created: boolean;
  /** True when this call moved the dispute to a new status. */
  statusChanged: boolean;
  purchaseStatusBefore: LeadPurchaseStatus;
  purchaseStatusAfter: LeadPurchaseStatus;
  effect: LeadFeeDisputePurchaseEffect;
}

export interface ReconcileLeadPurchaseDisputesResult {
  purchaseStatusBefore: LeadPurchaseStatus;
  purchaseStatusAfter: LeadPurchaseStatus;
  effect: LeadFeeDisputePurchaseEffect;
}

/** The existing dispute row carries a different purchase / payment / charge than the event: never re-associated. */
export class LeadFeeDisputeAssociationConflictError extends Error {
  constructor() {
    super("The dispute is already associated with a different purchase, payment or charge.");
    this.name = "LeadFeeDisputeAssociationConflictError";
  }
}

export class LeadFeeDisputeEvidenceConflictError extends Error {
  constructor() {
    super("The dispute evidence state does not allow this step.");
    this.name = "LeadFeeDisputeEvidenceConflictError";
  }
}

export interface ClaimLeadFeeDisputeEvidenceInput {
  disputeId: string;
  actorUserId: string;
  /** Opaque incident / evidence reference (separate from the evidence text). */
  evidenceReference: string;
  /** The evidence text to send, 1..1000 characters, stored verbatim so a re-run after an unknown outcome sends the identical text. */
  evidenceText: string;
  /** Application clock; the audit entry carries no text. */
  now: Date;
}

export interface LeadFeeDisputeRepository {
  /**
   * ONE transaction: locks the purchase row, inserts the dispute (first event) or advances it (forward-only), applies the
   * purchase effect the dispute's CURRENT status requires (suspend / restore / revoke), writes the revocation record on a
   * loss, and appends the audit entries. Replays, stale and out-of-order events change nothing and write no audit entry.
   * Throws LeadFeeDisputeAssociationConflictError (nothing written) when the dispute id is already bound to something else.
   */
  applyEvent(command: ApplyLeadFeeDisputeEventCommand): Promise<ApplyLeadFeeDisputeEventResult>;

  /**
   * Re-evaluates a purchase against ALL its recorded disputes and applies the required effect (same rules and same
   * transaction guarantees as `applyEvent`). Used right after a payment is confirmed, so a dispute that arrived BEFORE the
   * confirmation (out-of-order delivery) is never lost. Idempotent; returns effect NONE when nothing is required.
   */
  reconcilePurchase(leadPurchaseId: string, now: Date): Promise<ReconcileLeadPurchaseDisputesResult | null>;

  findById(id: string): Promise<LeadFeeDisputeRecord | null>;
  findByProviderDisputeId(providerDisputeId: string): Promise<LeadFeeDisputeRecord | null>;
  listByPurchaseId(leadPurchaseId: string): Promise<LeadFeeDisputeRecord[]>;

  /** Evidence step 1 (conditional NOT_SUBMITTED -> SUBMISSION_PENDING, audited, one transaction). Throws LeadFeeDisputeEvidenceConflictError when not NOT_SUBMITTED. */
  claimEvidenceSubmission(input: ClaimLeadFeeDisputeEvidenceInput): Promise<LeadFeeDisputeRecord>;
  /** Evidence step 2 (conditional SUBMISSION_PENDING -> SUBMITTED, audited). Idempotent when already SUBMITTED by the same dispute. */
  markEvidenceSubmitted(disputeId: string, actorUserId: string, now: Date): Promise<LeadFeeDisputeRecord>;
  /** The provider DEFINITIVELY rejected the submission: SUBMISSION_PENDING -> NOT_SUBMITTED so a controlled retry is possible. */
  releaseEvidenceClaim(disputeId: string): Promise<LeadFeeDisputeRecord>;
}

// ---------------------------------------------------------------- administrative revocation

export interface RevokeLeadPurchaseCommand {
  leadPurchaseId: string;
  actorUserId: string;
  /** 1..1000 characters, stored verbatim, never in the audit entry. */
  explanation: string;
  /** Opaque incident / evidence reference. */
  evidenceReference: string;
  now: Date;
}

export interface RevokeLeadPurchaseResult {
  purchaseStatusBefore: LeadPurchaseStatus;
  purchaseStatusAfter: LeadPurchaseStatus;
  /** False when the purchase was already REVOKED (idempotent repeat): nothing was written. */
  revoked: boolean;
  revocationId: string | null;
}

export interface LeadPurchaseRevocationRepository {
  /**
   * ONE transaction: locks the purchase, requires CONFIRMED, moves it to REVOKED (status-conditional, stamps revokedAt),
   * inserts the revocation record (actor, explanation, evidence reference) and the audit entry. Already REVOKED = idempotent
   * no-op (`revoked: false`). Any other status is rejected by the caller's pre-check and again by the conditional write.
   */
  revokeConfirmed(command: RevokeLeadPurchaseCommand): Promise<RevokeLeadPurchaseResult>;
}
