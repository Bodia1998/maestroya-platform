import type { OpenSeverityCounts, ReconciliationDiscrepancyRepository } from "@/domain/repositories/reconciliation-repository";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations. Read-only.
 * The run detail page's "severity breakdown" section — every discrepancy
 * this specific run detected, grouped by severity, regardless of whether
 * it has since been resolved (unlike the overview's
 * `getOpenSeverityCounts`, which is open-only and run-agnostic). Kept as
 * its own tiny use case rather than folded into `GetReconciliationRunUseCase`
 * so that use case's existing return shape (a bare `ReconciliationRunRecord`)
 * stays unchanged for its other caller.
 */
export class GetReconciliationRunSeverityBreakdownUseCase {
  constructor(private readonly discrepancies: ReconciliationDiscrepancyRepository) {}

  async execute(runId: string): Promise<OpenSeverityCounts> {
    return this.discrepancies.getSeverityCountsForRun(runId);
  }
}
