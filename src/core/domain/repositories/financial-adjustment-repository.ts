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

/**
 * Module 69 — Financial Ledger & Payout Readiness: the adjustment types
 * that return money to the customer (directly or via a fee refund) and are
 * therefore bounded by `Payment.amount` — Invariant 8 ("Refund
 * boundedness"). `CreateFinancialAdjustmentUseCase` sums already-`APPLIED`
 * adjustments of exactly these types against a Payment (via
 * `sumAppliedAmountForPayment` below) before allowing a new one, so two
 * separate disputes/adjustments against the same Payment can never
 * cumulatively refund more than was captured. `PROFESSIONAL_PAYOUT_REDUCTION`/
 * `CUSTOMER_COMPENSATION`/`COMMISSION_REVERSAL`/`PROFESSIONAL_PAYOUT_RELEASE`
 * are deliberately excluded — they redistribute what MaestroYa/the
 * professional retain, they do not return captured customer funds, so they
 * are not bounded by this same invariant (a payout reduction is instead
 * bounded by the professional's own net earning — see
 * `check-payout-readiness.use-case.ts`).
 */
export const REFUND_TYPE_ADJUSTMENTS: readonly FinancialAdjustmentTypeValue[] = [
  "FULL_REFUND",
  "PARTIAL_REFUND",
  "PLATFORM_FEE_REFUND",
];

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
  /** Module 69 — Financial Ledger & Payout Readiness: sum of `amount` for
   *  every `APPLIED` adjustment against this Payment whose `type` is one of
   *  `types` — `PENDING`/`FAILED`/`REJECTED` adjustments are excluded, since
   *  only an `APPLIED` adjustment actually moved money (see
   *  `REFUND_TYPE_ADJUSTMENTS`'s own doc comment for why this exists). Used
   *  by `CreateFinancialAdjustmentUseCase` to enforce Invariant 8 and by the
   *  reconciliation service to report a Payment's true refunded total. */
  sumAppliedAmountForPayment(paymentId: string, types: readonly FinancialAdjustmentTypeValue[]): Promise<number>;
}
