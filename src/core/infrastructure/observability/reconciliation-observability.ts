import "server-only";

import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Wired entirely into the existing structured logger (Module 25) — no new
 * transport. `logger` already redacts any key matching a
 * secret/token/credential pattern (see `logger.ts`'s own doc comment);
 * this module additionally never passes a raw Stripe payload, card
 * number, or full payment-provider response into any of these calls —
 * only opaque ids and already-rounded monetary figures ever appear here,
 * satisfying the spec's "never log sensitive payment information" rule at
 * the call-site level as well as the logger's own redaction layer.
 *
 * - `started`/`completed` -> `info`. Routine, expected activity.
 * - `failed` -> `error`. The engine itself broke — always operationally
 *   significant.
 * - `discrepancy detected` -> `warn` for ERROR, `error` for CRITICAL,
 *   `info` otherwise — severity-proportionate log level so a CRITICAL
 *   finding is never buried at the same level as an INFO one.
 * - `discrepancy resolved` -> `info`.
 */

export function recordReconciliationStarted(fields: { runId: string; scope: string; triggeredByUserId: string | null }): void {
  logger.info("reconciliation.run_started", fields);
}

export function recordReconciliationCompleted(fields: {
  runId: string;
  scope: string;
  recordsInspected: number;
  discrepancyCount: number;
  durationMs: number;
}): void {
  logger.info("reconciliation.run_completed", fields);
}

export function recordReconciliationFailed(fields: {
  runId: string;
  scope: string;
  errorMessage: string;
  recordsInspected: number;
}): void {
  logger.error("reconciliation.run_failed", fields);
}

export function recordDiscrepancyDetected(fields: {
  discrepancyId: string;
  runId: string;
  category: string;
  severity: string;
  entityType: string;
  entityId: string | null;
  jobId: string | null;
  expectedValue: number | null;
  actualValue: number | null;
  differenceValue: number | null;
}): void {
  const level = fields.severity === "CRITICAL" ? "error" : fields.severity === "ERROR" ? "warn" : "info";
  logger[level]("reconciliation.discrepancy_detected", fields);
}

export function recordDiscrepancyResolved(fields: {
  discrepancyId: string;
  resolvedByUserId: string;
  category: string;
  severity: string;
}): void {
  logger.info("reconciliation.discrepancy_resolved", fields);
}

/**
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * One log line per `RunScheduledReconciliationSweepUseCase.execute()`
 * outcome, always carrying `cursorKey`/`cursorBefore`/`cursorAfter`/
 * `cycleNumber` so an operator can answer "where is the sweep right now,
 * and is it moving" from logs alone — see that use case's own doc
 * comment for what each outcome means. Never logs a Job id list (only
 * `recordsSelected`, a count) — the per-Job/per-discrepancy detail
 * already goes through `recordReconciliationStarted`/`Completed`/
 * `Failed`/`recordDiscrepancyDetected` above via the inner
 * `StartReconciliationRunUseCase` call this use case makes.
 */
export function recordScheduledSweepSkippedLocked(fields: { cursorKey: string }): void {
  logger.info("reconciliation.scheduled_sweep_skipped_locked", fields);
}

export function recordScheduledSweepSkippedEmpty(fields: {
  cursorKey: string;
  cycleNumber: number;
  cycleCompleted: boolean;
}): void {
  logger.info("reconciliation.scheduled_sweep_skipped_empty", fields);
}

export function recordScheduledSweepBatchFailed(fields: {
  cursorKey: string;
  runId: string;
  cursorBefore: { createdAt: string | null; jobId: string | null };
  recordsSelected: number;
  errorMessage: string | null;
}): void {
  logger.error("reconciliation.scheduled_sweep_batch_failed", fields);
}

export function recordScheduledSweepAdvanced(fields: {
  cursorKey: string;
  runId: string;
  cursorBefore: { createdAt: string | null; jobId: string | null };
  cursorAfter: { createdAt: string | null; jobId: string | null };
  recordsSelected: number;
  cycleNumber: number;
  cycleCompleted: boolean;
  durationMs: number;
}): void {
  logger.info("reconciliation.scheduled_sweep_advanced", fields);
}

/**
 * Belt-and-suspenders race detected (see
 * `ReconciliationScheduleCursorRepository.advance`'s own doc comment) —
 * should never happen given the `DistributedLock` the sweep use case
 * already holds, so this is `warn`, not `info`, even though the batch
 * itself was reconciled successfully and nothing financial was lost.
 */
export function recordScheduledSweepCursorRace(fields: { cursorKey: string; runId: string }): void {
  logger.warn("reconciliation.scheduled_sweep_cursor_race", fields);
}
