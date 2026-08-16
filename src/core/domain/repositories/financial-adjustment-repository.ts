/**
 * Module 22 — Commission & Financial: repository interface for the
 * `FinancialAdjustment` model — the boundary Module 21 (Disputes &
 * Support) uses to request a financial consequence of a resolved dispute
 * without executing money movement itself. See schema.prisma's own doc
 * comment on FinancialAdjustment for the two-step create-then-apply shape.
 */

export type FinancialAdjustmentTypeValue =
  | "FULL_REFUND"
  | "PARTIAL_REFUND"
  | "PROFESSIONAL_PAYOUT_REDUCTION"
  | "PROFESSIONAL_PAYOUT_RELEASE"
  | "CUSTOMER_COMPENSATION"
  | "PLATFORM_FEE_REFUND"
  | "COMMISSION_REVERSAL";

export type FinancialAdjustmentStatusValue = "PENDING" | "APPLIED" | "REJECTED" | "FAILED";

export interface FinancialAdjustmentRecord {
  id: string;
  jobId: string;
  disputeId: string | null;
  paymentId: string | null;
  type: FinancialAdjustmentTypeValue;
  status: FinancialAdjustmentStatusValue;
  amount: number;
  currency: string;
  reason: string | null;
  requestedByUserId: string;
  idempotencyKey: string;
  transactionId: string | null;
  /** Module 68 — Dispute Resolution & Financial Protection: the
   *  `DisputeResolutionDecision` this adjustment was created to carry out,
   *  if any — `null` for adjustments created outside Module 68's atomic
   *  resolution flow (there are none as of Module 68, but the field stays
   *  optional/nullable so this interface never requires a caller outside
   *  that flow to fabricate one). See
   *  `dispute-resolution-decision-repository.ts`'s own doc comment for why
   *  a single decision can require more than one adjustment. */
  resolutionDecisionId: string | null;
  appliedAt: Date | null;
  createdAt: Date;
}

export interface CreateFinancialAdjustmentData {
  jobId: string;
  disputeId: string | null;
  paymentId: string | null;
  type: FinancialAdjustmentTypeValue;
  amount: number;
  reason: string | null;
  requestedByUserId: string;
  idempotencyKey: string;
  /** See `FinancialAdjustmentRecord.resolutionDecisionId`'s own doc
   *  comment. Optional — every pre-Module-68 caller of this repository
   *  omits it, unchanged. */
  resolutionDecisionId?: string | null;
}

export interface FinancialAdjustmentRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<FinancialAdjustmentRecord | null>;
  findById(id: string): Promise<FinancialAdjustmentRecord | null>;
  create(data: CreateFinancialAdjustmentData): Promise<FinancialAdjustmentRecord>;
  /** Links the ledger Transaction created for this adjustment and marks it
   *  APPLIED — see schema.prisma's FinancialAdjustment doc comment on why
   *  this is a separate step from `create`. */
  markApplied(id: string, transactionId: string): Promise<FinancialAdjustmentRecord>;
  markFailed(id: string): Promise<FinancialAdjustmentRecord>;
  listForJob(jobId: string): Promise<FinancialAdjustmentRecord[]>;
}
