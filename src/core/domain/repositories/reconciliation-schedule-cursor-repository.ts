/**
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * Repository port for the single new persisted aggregate this module
 * introduces: `ReconciliationScheduleCursor` — the durable checkpoint the
 * scheduled reconciliation sweep advances across runs so that repeated
 * invocations eventually cover the entire eligible Job ledger instead of
 * repeatedly rescanning the same most-recently-active window. See the
 * `ReconciliationScheduleCursor` Prisma model's own doc comment for the
 * full cursor-field/concurrency-model reasoning, and
 * `RunScheduledReconciliationSweepUseCase`'s own doc comment for how this
 * port is used.
 *
 * Kept as its own port (own file, own interface) rather than folded into
 * `domain/repositories/reconciliation-repository.ts` — that file's own
 * two aggregates (`ReconciliationRun`, `ReconciliationDiscrepancy`) are
 * Module 80's read-many, write-append-only history; this aggregate is a
 * single mutable checkpoint row with its own, different concurrency
 * contract (optimistic-concurrency conditional updates). Mixing the two
 * into one file/interface would blur that distinction for no benefit.
 */

export interface ReconciliationScheduleCursorRecord {
  id: string;
  cursorKey: string;
  /** Null means "start of a cycle" — the next batch begins at the very
   *  first eligible Job in (createdAt, id) order. */
  lastCreatedAt: Date | null;
  lastJobId: string | null;
  /** How many full passes over the eligible ledger have completed. Starts
   *  at 1 for the first (in-progress) cycle — observability only, never
   *  read by cursor-advancement logic itself. */
  cycleNumber: number;
  cycleStartedAt: Date;
  lastAdvancedAt: Date | null;
  /** Optimistic-concurrency token — see the Prisma model's own doc
   *  comment on why this exists underneath the `DistributedLock` the
   *  scheduled sweep use case already holds. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdvanceReconciliationScheduleCursorData {
  cursorKey: string;
  /** The `version` this write was read at — the conditional `UPDATE`
   *  succeeds only if the row's current `version` still matches this
   *  value (see `ReconciliationScheduleCursorRepository.advance`'s own
   *  doc comment). */
  expectedVersion: number;
  /** Null resets the cursor to the start of a new cycle. */
  lastCreatedAt: Date | null;
  lastJobId: string | null;
  cycleNumber: number;
  cycleStartedAt: Date;
}

export interface ReconciliationScheduleCursorRepository {
  /**
   * Returns the cursor row for `cursorKey`, creating it (at its initial
   * "start of cycle 1" state — `lastCreatedAt`/`lastJobId` both null,
   * `cycleNumber` 1, `version` 0) the first time it is requested. Safe to
   * call concurrently — see the Prisma implementation's own doc comment
   * for how the create race itself is resolved.
   */
  getOrCreate(cursorKey: string): Promise<ReconciliationScheduleCursorRecord>;

  /**
   * Conditionally advances the cursor: succeeds (returns the updated
   * record) only if the row's current `version` still equals
   * `data.expectedVersion` at the moment of the write, and always leaves
   * the row's `version` one higher than it found it. Returns `null` — never
   * throws — if the condition did not hold (someone else already advanced
   * this cursor since it was read); the caller decides what a lost race
   * means for it (see `RunScheduledReconciliationSweepUseCase`'s own doc
   * comment: under normal operation this should never happen, because the
   * use case already serializes concurrent invocations with a
   * `DistributedLock` before ever reading the cursor — this is a second,
   * independent safety net, not the primary concurrency control).
   */
  advance(data: AdvanceReconciliationScheduleCursorData): Promise<ReconciliationScheduleCursorRecord | null>;
}
