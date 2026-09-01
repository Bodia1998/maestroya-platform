import type { JobFinancialContext } from "@/domain/services/reconciliation/context";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Bulk, read-only query surface the reconciliation engine scans over.
 * Deliberately its own port (in `application/ports/`, not
 * `domain/repositories/`) rather than widening any Module 22/64/73-79
 * repository — those repositories are all narrow, single-entity-by-id
 * interfaces by design (see e.g. `InvoiceRepository`'s own doc comment);
 * reconciliation instead needs bulk, paginated, cross-entity reads no
 * existing repository was ever meant to serve, and adding them there
 * would be scope creep into modules this one must not modify.
 *
 * Every method here is read-only. The Prisma-backed implementation
 * (`PrismaReconciliationDataSource`) never calls a Prisma `create`/
 * `update`/`delete` against any Module 73-79 table.
 */
export interface ListJobsForReconciliationOptions {
  /** Only Jobs whose most recent relevant financial activity
   *  (Payment/Invoice/Payout/Refund/CreditNote `updatedAt`) is on/after
   *  this date. Omit to scan the most recent `limit` jobs regardless of
   *  age — see `PrismaReconciliationDataSource`'s own doc comment on why
   *  a single run is deliberately bounded rather than an unbounded
   *  full-table scan. */
  since?: Date;
  limit: number;
  cursor?: string;
}

/**
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * An opaque, composite keyset-pagination position for
 * `listJobIdsToInspectFromCursor` — see that method's own doc comment for
 * why (createdAt, id), not a single scalar.
 */
export interface ReconciliationJobCursor {
  createdAt: Date;
  id: string;
}

export interface ListJobsForReconciliationCursorOptions {
  /** Strictly-after position in (createdAt, id) order — null starts from
   *  the very first eligible Job. */
  after: ReconciliationJobCursor | null;
  limit: number;
}

export interface ReconciliationJobCursorBatch {
  /** Job ids in this batch, in the same (createdAt, id) ascending order
   *  the query used — never re-sorted by the caller. */
  jobIds: string[];
  /** The cursor position of the last Job in `jobIds` — the value the next
   *  call's `after` should use to continue from exactly where this batch
   *  left off. Null when `jobIds` is empty. */
  nextCursor: ReconciliationJobCursor | null;
  /** True when this batch reached the end of the eligible dataset (fewer
   *  rows existed after `after` than `limit`) — the caller's signal to
   *  reset the cursor to the start of a new cycle once this batch is
   *  successfully reconciled, rather than waiting for a subsequent,
   *  separately-detected empty batch. */
  cycleCompleted: boolean;
}

export interface ReconciliationDataSource {
  /** Job ids with at least one Payment, ordered by most-recently-relevant
   *  financial activity first. The unit `StartReconciliationRunUseCase`
   *  iterates over — see `JobFinancialContext`'s own doc comment for why
   *  a single per-job read gathers the entire lifecycle chain in one
   *  shot.
   *
   *  Used only by admin/manually-triggered runs (which choose their own
   *  `since`/`limit` window on purpose — see `startReconciliationRunSchema`).
   *  The *scheduled* sweep does not call this method at all — see
   *  `listJobIdsToInspectFromCursor` below. */
  listJobIdsToInspect(options: ListJobsForReconciliationOptions): Promise<string[]>;

  /**
   * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
   *
   * The bulk read the *scheduled* reconciliation sweep uses instead of
   * `listJobIdsToInspect` above: a bounded, deterministically-ordered
   * keyset page of eligible Job ids strictly after `options.after`,
   * ordered by `(createdAt ASC, id ASC)`.
   *
   * `(createdAt, id)`, not `updatedAt` or `id` alone, and not descending:
   * see `PrismaReconciliationDataSource`'s own doc comment on this method
   * for the full reasoning (in short — `Job.updatedAt` is not a reliable
   * proxy for "financial activity happened," `createdAt` is immutable and
   * monotonic so newly-created Jobs are always appended ahead of wherever
   * the cursor currently sits, and ascending order combined with resuming
   * exactly at `options.after` is what makes repeated bounded calls
   * eventually cover every eligible Job — including ones created after
   * the sweep began — without ever re-scanning the whole table in one
   * call).
   */
  listJobIdsToInspectFromCursor(options: ListJobsForReconciliationCursorOptions): Promise<ReconciliationJobCursorBatch>;

  /** Gathers every Module 73-79 record relevant to one Job — the input
   *  every check module in `domain/services/reconciliation/*` consumes. */
  getJobFinancialContext(jobId: string): Promise<JobFinancialContext | null>;
}
