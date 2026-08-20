/**
 * Module 76 — Professional Payout Execution.
 *
 * Write-capable repository interface for the existing `Payout` model
 * (schema.prisma) — the first writer of this table (see
 * `ProfessionalPayoutLedgerRepository`'s own "no writer of Payout exists
 * yet" doc comment, which this module resolves). Deliberately kept
 * separate from `ProfessionalPayoutLedgerRepository`
 * (`domain/repositories/professional-payout-ledger-repository.ts`) — that
 * interface stays exactly the narrow, read-only aggregate seam it always
 * was (`sumPaidForProfessional`), never widened into a general read/write
 * API; this is the sibling write-side interface `Payout`'s doc comment
 * always anticipated growing.
 *
 * One row per Job (`jobId` is unique at the database level — see the
 * migration's own doc comment) — this is the single source of truth
 * `ExecuteProfessionalPayoutUseCase` reads/writes to decide "has this
 * Job's payout already been executed, is one in flight, or did the last
 * attempt fail."
 */

export type PayoutStatusValue = "PENDING" | "IN_TRANSIT" | "PAID" | "FAILED" | "CANCELLED";

export interface PayoutRecord {
  id: string;
  jobId: string | null;
  paymentId: string | null;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  amount: number;
  currency: string;
  status: PayoutStatusValue;
  /** Stripe's own `Transfer.id` (`tr_...`) — set only once `status` first
   *  reaches `PAID`. Never set, then unset — see `markPaid`'s own doc
   *  comment. */
  stripeTransferId: string | null;
  /** The deterministic `payout:<jobId>` key — both this row's own
   *  duplicate guard and the Stripe request idempotency key reused across
   *  every retried execution attempt. */
  idempotencyKey: string | null;
  /** Set only when `status === "FAILED"` — the reason surfaced by the
   *  most recent failed attempt. Cleared (set back to `null`) once a
   *  later retry succeeds — see `markPaid`. */
  failureReason: string | null;
  attemptCount: number;
  lastAttemptedAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The exact set of fields `ExecuteProfessionalPayoutUseCase` persists the
 * instant it decides a Job's payout is about to be attempted — always in
 * `PENDING` status. Exactly one of `professionalProfileId`/
 * `companyProfileId` is set, mirroring the existing `Payout` model's own
 * solo-pro-vs-company duality (see that model's own doc comment).
 */
export interface CreatePendingPayoutData {
  jobId: string;
  paymentId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

/**
 * Compare-and-swap guard — the same "fold the guard into the write"
 * convention `PaymentRepository.updateStatus`/
 * `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale`
 * already establish (see either's own doc comment): the caller states the
 * status/statuses it expects the row to currently be in, and the
 * implementation applies the write atomically only if the row's *current*
 * database status still matches at write time. This is what makes
 * concurrent/duplicate execution of the same Job's payout safe without a
 * distributed lock being the only line of defense.
 */
export interface MarkPayoutPaidInput {
  id: string;
  stripeTransferId: string;
  fromStatuses: readonly PayoutStatusValue[];
}

export interface MarkPayoutFailedInput {
  id: string;
  failureReason: string;
  fromStatuses: readonly PayoutStatusValue[];
}

export interface UpdatePayoutResult {
  /** `true` only if this call's own `UPDATE` actually matched and changed
   *  the row — see `MarkPayoutPaidInput`/`MarkPayoutFailedInput`'s own doc
   *  comment. */
  applied: boolean;
  /** The row's state *after* this call, whether or not `applied` is true —
   *  a caller that lost the race can still read the (now-current, set by
   *  whoever won) record without a second round trip. */
  record: PayoutRecord;
}

export interface PayoutRepository {
  findById(id: string): Promise<PayoutRecord | null>;

  /** The one lookup `ExecuteProfessionalPayoutUseCase` runs before doing
   *  anything else — "does a Payout already exist for this Job." */
  findByJobId(jobId: string): Promise<PayoutRecord | null>;

  /**
   * Insert-or-return-existing, keyed on `jobId`'s database-level unique
   * constraint (mirrors `PaymentRepository.create`'s own "the database's
   * uniqueness constraint, not application code, is what guarantees only
   * one row ever results" convention — see that method's own doc
   * comment). MUST NEVER overwrite an already-existing row for this
   * `jobId`: two concurrent first-time executions of the same Job's
   * payout can both call this and must both receive the SAME row back
   * (whichever one the database actually inserted), never a second row
   * and never a silently-updated first row.
   */
  createPending(data: CreatePendingPayoutData): Promise<PayoutRecord>;

  /** See `MarkPayoutPaidInput`'s own doc comment. Also clears
   *  `failureReason` back to `null` — a payout that eventually succeeds
   *  after one or more failed attempts must not keep displaying a stale
   *  failure reason once it's actually `PAID`. */
  markPaid(input: MarkPayoutPaidInput): Promise<UpdatePayoutResult>;

  /** See `MarkPayoutFailedInput`'s own doc comment. Increments
   *  `attemptCount` and sets `lastAttemptedAt` to now only when `applied`
   *  is `true` — a call that loses the compare-and-swap race (the row was
   *  already moved to a different status by a concurrent writer) has no
   *  effect at all, exactly like `markPaid`. */
  markFailed(input: MarkPayoutFailedInput): Promise<UpdatePayoutResult>;
}
