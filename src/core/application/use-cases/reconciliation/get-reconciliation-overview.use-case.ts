import type {
  CategoryCount,
  OpenSeverityCounts,
  ReconciliationDiscrepancyRepository,
  ReconciliationRunRepository,
  ReconciliationRunRecord,
} from "@/domain/repositories/reconciliation-repository";

export interface ReconciliationOverview {
  latestRun: ReconciliationRunRecord | null;
  lastSuccessfulRun: ReconciliationRunRecord | null;
  lastFailedRun: ReconciliationRunRecord | null;
  totalRuns: number;
  discrepancies: {
    open: number;
    resolved: number;
    bySeverity: OpenSeverityCounts;
    byCategory: CategoryCount[];
  };
}

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations. Read-only.
 *
 * The one query the admin overview page needs — every figure it displays
 * (latest run, last successful/failed run, total run count, open/resolved
 * discrepancy totals, the open-severity and open-category breakdowns)
 * comes from an existing Module 80 repository method (`list`/`count` on
 * `ReconciliationRunRepository`, `countByResolutionStatus`/
 * `getOpenSeverityCounts`/`getOpenCategoryCounts` on
 * `ReconciliationDiscrepancyRepository` — the latter three added by this
 * module specifically because Module 80 had no aggregate query for them;
 * see those methods' own doc comments). This use case does not compute or
 * derive a single figure itself — it only orchestrates the handful of
 * already-bounded queries (three `list({ limit: 1, ... })` calls, four
 * `COUNT`/`groupBy` aggregates) into one DTO, run concurrently so the
 * overview page issues one round trip rather than seven sequential ones.
 *
 * Never loads an unbounded set of rows: every run query is `limit: 1`,
 * every discrepancy query is a database-side aggregate.
 */
export class GetReconciliationOverviewUseCase {
  constructor(
    private readonly runs: ReconciliationRunRepository,
    private readonly discrepancies: ReconciliationDiscrepancyRepository,
  ) {}

  async execute(): Promise<ReconciliationOverview> {
    const [latestRuns, successfulRuns, failedRuns, totalRuns, resolutionCounts, bySeverity, byCategory] = await Promise.all([
      this.runs.list({ limit: 1, offset: 0 }),
      this.runs.list({ limit: 1, offset: 0, status: "COMPLETED" }),
      this.runs.list({ limit: 1, offset: 0, status: "FAILED" }),
      this.runs.count(),
      this.discrepancies.countByResolutionStatus(),
      this.discrepancies.getOpenSeverityCounts(),
      this.discrepancies.getOpenCategoryCounts(),
    ]);

    return {
      latestRun: latestRuns[0] ?? null,
      lastSuccessfulRun: successfulRuns[0] ?? null,
      lastFailedRun: failedRuns[0] ?? null,
      totalRuns,
      discrepancies: {
        open: resolutionCounts.open,
        resolved: resolutionCounts.resolved,
        bySeverity,
        byCategory,
      },
    };
  }
}
