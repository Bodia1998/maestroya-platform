import type { DisputeResolutionValue } from "@/domain/repositories/dispute-repository";
import type { FinancialAdjustmentTypeValue } from "@/domain/repositories/financial-adjustment-repository";
import type { DisputeFinancialOutcomeValue } from "@/domain/services/dispute-resolution-financial-outcome";

/**
 * Module 68 — Dispute Resolution & Financial Protection: repository
 * interface for `DisputeResolutionDecision` — the one authoritative,
 * persisted, auditable record this module's brief requires: WHAT was
 * decided, WHY, WHO decided it, WHEN, WHAT financial consequence it has,
 * WHICH dispute/job/payment it belongs to, and WHETHER it has already been
 * applied.
 *
 * ## Why a new model instead of reusing `Dispute.resolution`/`FinancialAdjustment`
 * `Dispute.resolution` (Module 21) already records the *business* outcome,
 * and `FinancialAdjustment` (Module 22) already records an individual
 * money-movement request — both are reused here unchanged, never
 * duplicated. Neither can safely stand in for this record on its own:
 * `Dispute.resolution` has no place to record whether the resulting money
 * movement was ever actually settled, and a `PARTIAL_RESOLUTION` can
 * legitimately require *more than one* `FinancialAdjustment` (e.g. a
 * partial refund to the customer alongside a payout reduction for the
 * professional) with no existing field tying that set of adjustments back
 * to the single decision that authorized all of them together. This model
 * is that missing link — see `ResolveDisputeWithFinancialOutcomeUseCase`.
 *
 * ## Immutability
 * At most one `DisputeResolutionDecision` ever exists per Dispute
 * (`disputeId` unique — enforced at the DB level, same "check in the use
 * case, the DB is the final guarantee" convention as
 * `PrismaDisputeRepository.create`). The decision's own facts (`outcome`,
 * `resolution`, `reason`, `decidedByUserId`, `decidedAt`) are written
 * exactly once at `create()` and never mutated afterward — only `status`/
 * `appliedAt` ever advance, via `markApplied`/`markPartiallyApplied`/
 * `markFailed`, mirroring `FinancialAdjustment`'s own two-step
 * create-then-apply shape. There is no `update` method for the decision's
 * own fields — a correction is always a fresh Dispute + fresh decision,
 * never an edit of this one.
 */

export type DisputeResolutionDecisionStatusValue = "PENDING_APPLICATION" | "APPLIED" | "PARTIALLY_APPLIED" | "FAILED";

export interface DisputeResolutionDecisionRecord {
  id: string;
  disputeId: string;
  jobId: string;
  /** Snapshot of the Payment this decision was evaluated against, if any
   *  existed at decision time — never re-resolved later. */
  paymentId: string | null;
  /** Denormalized copy of `Dispute.resolution` at the instant this
   *  decision was created — see this file's own doc comment on why a
   *  `PARTIAL_RESOLUTION` needing multiple adjustments still has exactly
   *  one `resolution` value. */
  resolution: DisputeResolutionValue;
  outcome: DisputeFinancialOutcomeValue;
  status: DisputeResolutionDecisionStatusValue;
  reason: string;
  decidedByUserId: string;
  decidedAt: Date;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDisputeResolutionDecisionData {
  disputeId: string;
  jobId: string;
  paymentId: string | null;
  resolution: DisputeResolutionValue;
  outcome: DisputeFinancialOutcomeValue;
  reason: string;
  decidedByUserId: string;
  decidedAt: Date;
}

export interface DisputeResolutionDecisionRepository {
  findById(id: string): Promise<DisputeResolutionDecisionRecord | null>;
  /** The idempotency guard `ResolveDisputeWithFinancialOutcomeUseCase`
   *  checks before writing — see that use case's own doc comment. At most
   *  one row per dispute; the underlying `disputeId` unique constraint is
   *  the DB-level backstop. */
  findByDisputeId(disputeId: string): Promise<DisputeResolutionDecisionRecord | null>;
  /** Creates the decision. Implementations MUST translate a DB unique
   *  constraint violation on `disputeId` into a `ConflictError` rather
   *  than letting a raw Prisma error escape — same convention as
   *  `PrismaDisputeRepository.create`. */
  create(data: CreateDisputeResolutionDecisionData): Promise<DisputeResolutionDecisionRecord>;
  /** Every adjustment this decision required was successfully applied. */
  markApplied(id: string): Promise<DisputeResolutionDecisionRecord>;
  /** At least one adjustment applied, at least one failed — surfaced
   *  distinctly from `FAILED` (every adjustment failed) so an admin
   *  investigating knows partial money movement may already have
   *  happened. */
  markPartiallyApplied(id: string): Promise<DisputeResolutionDecisionRecord>;
  /** Every adjustment this decision required failed to apply — no money
   *  moved. */
  markFailed(id: string): Promise<DisputeResolutionDecisionRecord>;
}

export type { FinancialAdjustmentTypeValue };
