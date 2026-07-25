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
