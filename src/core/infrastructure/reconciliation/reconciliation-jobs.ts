import type { ReconciliationScopeValue } from "@/domain/repositories/reconciliation-repository";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 90 — Automated Reconciliation & Financial Alerting.
 *
 * The job vocabulary for the scheduled reconciliation trigger — this
 * module's analogue of `analytics/analytics-refresh-jobs.ts` /
 * `backup/backup-jobs.ts`. Adds no retry/backoff/dead-letter machinery of
 * its own (Module 45's `Worker` already implements all three); what is
 * genuinely new here is which job gets which id.
 */

export const RECONCILIATION_RUN_QUEUE_NAME = "reconciliation-run";
export const RECONCILIATION_RUN_DEAD_LETTER_QUEUE_NAME = "reconciliation-run-dead-letter";

export interface ReconciliationRunJobData {
  scope: ReconciliationScopeValue;
  limit: number;
  reason: "scheduled" | "manual";
}

/**
 * Execution-time idempotency key (Module 45's `Worker.idempotency`) —
 * deliberately opted out (`null`), mirroring
 * `analyticsRefreshJobIdempotencyKey`'s own reasoning. Running the
 * reconciliation engine twice for a redelivered job is always safe: the
 * engine itself always creates a fresh `ReconciliationRun` row by design
 * (see `StartReconciliationRunUseCase`'s own "safe to invoke
 * concurrently" doc comment), and every discrepancy it would find is
 * already deduplicated one level down, at the database, by
 * `ReconciliationDiscrepancyRepository.createOrTouch`'s fingerprint +
 * partial unique index. A skip-on-redelivery policy here would add risk
 * (a legitimate re-run silently skipped) for no benefit (there is nothing
 * unsafe about running it again).
 *
 * Duplicate *scheduling* — the actual "must not execute duplicate
 * reconciliation runs concurrently for the same scope/window" requirement
 * — is handled one layer up, at enqueue time, by `JobScheduler`'s own
 * deterministic occurrence id (`repeat:<name>:<occurrenceMs>`, see that
 * class's own doc comment) — this function only concerns *execution-time*
 * at-least-once redelivery of a job that already made it into the queue.
 */
export function reconciliationRunJobIdempotencyKey(_job: ActiveJob<ReconciliationRunJobData>): string | null {
  return null;
}
