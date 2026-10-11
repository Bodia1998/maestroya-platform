import { DomainError } from "@/domain/errors/domain-error";
import type { LeadFeeRefundReasonCode, LeadFeeRefundStatus } from "@/domain/services/lead-fee-refund";

/**
 * Module 153 — persistence port of lead-fee refund ATTEMPTS (table `lead_fee_refunds`). History is kept: there is no
 * delete, no money update and no way to rewrite an attempt; status moves are conditional on the expected current status.
 */
export interface LeadFeeRefundRecord {
  id: string;
  leadPurchaseId: string;
  reasonCode: LeadFeeRefundReasonCode;
  attemptNumber: number;
  status: LeadFeeRefundStatus;
  /** Exact 2-decimal string (never a JS number). */
  amount: string;
  currency: string;
  refundedPaymentReference: string;
  purchasePaymentReference: string;
  idempotencyKey: string;
  providerRefundId: string | null;
  actorUserId: string;
  explanation: string;
  evidenceReference: string;
  failureCategory: string | null;
  purchaseTransitionedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadFeeRefundDraft {
  leadPurchaseId: string;
  reasonCode: LeadFeeRefundReasonCode;
  attemptNumber: number;
  amount: string;
  currency: string;
  refundedPaymentReference: string;
  purchasePaymentReference: string;
  idempotencyKey: string;
  actorUserId: string;
  explanation: string;
  evidenceReference: string;
}

/** Another active attempt (or the same attempt number) already exists for the payment: the unique constraints fired. */
export class LeadFeeRefundAttemptConflictError extends DomainError {
  readonly code = "LEAD_FEE_REFUND_ATTEMPT_CONFLICT";
  constructor() {
    super("A refund attempt for this payment already exists.");
  }
}

/** The attempt was not in any of the expected statuses (a concurrent run moved it). */
export class LeadFeeRefundTransitionConflictError extends DomainError {
  readonly code = "LEAD_FEE_REFUND_TRANSITION_CONFLICT";
  constructor() {
    super("The refund attempt is no longer in the expected status.");
  }
}

export interface LeadFeeRefundStatusUpdate {
  /** The update applies only if the row is currently in one of these statuses. */
  from: readonly LeadFeeRefundStatus[];
  to: LeadFeeRefundStatus;
  providerRefundId?: string;
  failureCategory?: string;
}

export interface LeadFeeRefundRepository {
  /** All attempts for a provider payment, ascending by attempt number. */
  listByPaymentReference(paymentReference: string): Promise<LeadFeeRefundRecord[]>;
  /** Inserts a REQUESTED attempt. Throws LeadFeeRefundAttemptConflictError on a unique-constraint race. */
  createAttempt(draft: LeadFeeRefundDraft): Promise<LeadFeeRefundRecord>;
  /** Status-conditional move. Throws LeadFeeRefundTransitionConflictError when the row is not in a `from` status. */
  updateStatus(id: string, update: LeadFeeRefundStatusUpdate): Promise<LeadFeeRefundRecord>;
  /** Stamps the purchase-transition time once (SUCCEEDED PLATFORM_ERROR only). Returns true only for the call that stamped it. */
  markPurchaseTransitioned(id: string, at: Date): Promise<boolean>;
}
