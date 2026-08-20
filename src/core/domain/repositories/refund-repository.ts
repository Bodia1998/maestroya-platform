/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * Write-capable repository interface for the existing `Refund` model
 * (schema.prisma) — the first writer of this table. The `Refund` model
 * has existed, unused, since an early migration (mirrors `Payout`'s own
 * "no writer exists yet" history before Module 76 — see
 * `PayoutRepository`'s own doc comment); this module is what finally
 * connects it to a real Stripe refund call.
 *
 * Deliberately separate from `FinancialAdjustmentRepository`
 * (`domain/repositories/financial-adjustment-repository.ts`, Module 22):
 * that table records the *decision* — "a refund of this amount is owed,"
 * an internal ledger fact — and is never itself a record of a real Stripe
 * money movement (see `CreateFinancialAdjustmentUseCase`'s own doc
 * comment: it only ever writes an internal `Transaction`/ledger row, no
 * Stripe SDK call). `Refund` is the sibling table that DOES record the
 * real, external Stripe operation this module executes on that decision's
 * behalf — one `FinancialAdjustment` (of a refund type) results in at
 * most one `Refund`, correlated via `financialAdjustmentId`.
 *
 * One row per FinancialAdjustment (`financialAdjustmentId` unique at the
 * database level) — this is both this module's idempotency guard ("has a
 * Stripe refund already been requested/completed for this exact decided
 * adjustment") and the same "database uniqueness constraint, not
 * application code, is the guarantee" convention `PayoutRepository`/
 * `PaymentRepository` already establish.
 */

export type RefundStatusValue = "REQUESTED" | "APPROVED" | "REJECTED" | "PROCESSED" | "FAILED";

/** Statuses from which a refund execution attempt may still (re-)run —
 *  a fresh row (`REQUESTED`) or a previously failed attempt (`FAILED`,
 *  retried) — mirrors `RETRYABLE_PAYOUT_STATUSES`
 *  (`execute-professional-payout.use-case.ts`) exactly. `APPROVED`/
 *  `REJECTED` are reserved for a possible future manual-approval workflow
 *  this module does not implement — Module 77's refunds are always
 *  already-decided (by Module 68's dispute resolution), so every row this
 *  module writes goes `REQUESTED` -> `PROCESSED`/`FAILED` directly. */
export const RETRYABLE_REFUND_STATUSES: readonly RefundStatusValue[] = ["REQUESTED", "FAILED"];

export interface RefundRecord {
  id: string;
  paymentId: string;
  requestedByUserId: string;
  amount: number;
  status: RefundStatusValue;
  /** Stripe's own `Refund.id` (`re_...`) — set only once `status` first
   *  reaches `PROCESSED`. */
  stripeRefundId: string | null;
  processedAt: Date | null;
  notes: string | null;
  /** Module 77: the `FinancialAdjustment` (a refund-type one) this Refund
   *  executes — `null` only for a Refund that predates this column
   *  (never written by this module; every row this module creates sets
   *  it). This is the field `financialAdjustmentId`'s own unique index is
   *  keyed on — see this file's own doc comment. */
  financialAdjustmentId: string | null;
  /** Module 77: the deterministic `refund:<financialAdjustmentId>` key —
   *  both this row's own duplicate guard (redundant with
   *  `financialAdjustmentId`'s own uniqueness, kept as its own column so
   *  the Stripe idempotency key is never re-derived ad hoc at the call
   *  site — same "persist the exact key used" convention `Payout.
   *  idempotencyKey` establishes) and the Stripe request idempotency key
   *  reused across every retried execution attempt. */
  idempotencyKey: string | null;
  /** Set only when `status === "FAILED"` — the reason surfaced by the
   *  most recent failed attempt. Cleared back to `null` once a later
   *  retry succeeds — see `markProcessed`. */
  failureReason: string | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePendingRefundData {
  paymentId: string;
  requestedByUserId: string;
  amount: number;
  financialAdjustmentId: string;
  idempotencyKey: string;
  notes: string | null;
}

export interface MarkRefundProcessedInput {
  id: string;
  stripeRefundId: string;
  fromStatuses: readonly RefundStatusValue[];
}

export interface MarkRefundFailedInput {
  id: string;
  failureReason: string;
  fromStatuses: readonly RefundStatusValue[];
}

export interface UpdateRefundResult {
  /** `true` only if this call's own `UPDATE` actually matched and changed
   *  the row — see `PayoutRepository.UpdatePayoutResult`'s own doc
   *  comment for the identical CAS contract. */
  applied: boolean;
  record: RefundRecord;
}

export interface RefundRepository {
  findById(id: string): Promise<RefundRecord | null>;

  /** The idempotency lookup `ExecuteRefundUseCase` runs before doing
   *  anything else, and the reconciliation lookup the `charge.refunded`
   *  webhook handler runs by Stripe refund id (see
   *  `findByStripeRefundId`). */
  findByFinancialAdjustmentId(financialAdjustmentId: string): Promise<RefundRecord | null>;

  /** Module 77 — Stripe webhook reconciliation: correlates an inbound
   *  `charge.refunded` event's own `Refund.id` back to the row this
   *  module created for it. */
  findByStripeRefundId(stripeRefundId: string): Promise<RefundRecord | null>;

  /**
   * Insert-or-return-existing, keyed on `financialAdjustmentId`'s
   * database-level unique constraint — mirrors `PayoutRepository.
   * createPending`'s own "insert first, let the database's own
   * uniqueness constraint be the single source of truth" convention
   * exactly (see that method's own doc comment). Two concurrent
   * executions of the same logical refund decision must both receive the
   * SAME row back, never two.
   */
  createPending(data: CreatePendingRefundData): Promise<RefundRecord>;

  /** See `MarkRefundProcessedInput`'s own doc comment. Also clears
   *  `failureReason` back to `null`, mirroring `PayoutRepository.
   *  markPaid`. */
  markProcessed(input: MarkRefundProcessedInput): Promise<UpdateRefundResult>;

  /** See `MarkRefundFailedInput`'s own doc comment. Increments
   *  `attemptCount`, mirroring `PayoutRepository.markFailed`. */
  markFailed(input: MarkRefundFailedInput): Promise<UpdateRefundResult>;

  /** Sum of `amount` for every `PROCESSED` Refund against this Payment —
   *  used only by this module's own tests/observability today;
   *  `PaymentRepository.sumProcessedRefunds` (Module 69) remains the one
   *  authoritative source `ExecuteRefundUseCase` reads to enforce refund
   *  boundedness, never re-derived here. Kept for symmetry with
   *  `PayoutRepository`'s own per-aggregate read methods and for a future
   *  admin refund-history view. */
  listForPayment(paymentId: string): Promise<RefundRecord[]>;
}
