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

export interface ReconciliationDataSource {
  /** Job ids with at least one Payment, ordered by most-recently-relevant
   *  financial activity first. The unit `StartReconciliationRunUseCase`
   *  iterates over — see `JobFinancialContext`'s own doc comment for why
   *  a single per-job read gathers the entire lifecycle chain in one
   *  shot. */
  listJobIdsToInspect(options: ListJobsForReconciliationOptions): Promise<string[]>;

  /** Gathers every Module 73-79 record relevant to one Job — the input
   *  every check module in `domain/services/reconciliation/*` consumes. */
  getJobFinancialContext(jobId: string): Promise<JobFinancialContext | null>;
}
