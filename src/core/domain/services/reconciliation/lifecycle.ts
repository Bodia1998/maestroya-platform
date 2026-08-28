import type { ReconciliationRunStatusValue } from "@/domain/repositories/reconciliation-repository";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * The authoritative transition table for `ReconciliationRun.status`:
 * `RUNNING -> COMPLETED` or `RUNNING -> FAILED`. Both are terminal — a
 * run is never resumed or re-opened; a re-run is always a brand new run
 * row (see `StartReconciliationRunUseCase`). Mirrors
 * `domain/services/invoice-lifecycle.ts`'s own "pure transition table,
 * consulted by the use case before every write" convention.
 */
const TRANSITIONS: Record<ReconciliationRunStatusValue, readonly ReconciliationRunStatusValue[]> = {
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export function canTransitionReconciliationRunStatus(
  from: ReconciliationRunStatusValue,
  to: ReconciliationRunStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalReconciliationRunStatus(status: ReconciliationRunStatusValue): boolean {
  return TRANSITIONS[status].length === 0;
}
