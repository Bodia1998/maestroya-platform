import type { EventHandler } from "@/application/ports/event-bus";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import { ReconciliationRunStarted } from "@/domain/events/reconciliation-run-started";
import { ReconciliationRunCompleted } from "@/domain/events/reconciliation-run-completed";
import { ReconciliationRunFailed } from "@/domain/events/reconciliation-run-failed";
import type { DiscrepancyResolved } from "@/domain/events/discrepancy-resolved";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Integrates reconciliation run lifecycle + manual discrepancy resolution
 * into the platform's existing `AdminAuditLog` (Module 16's `AuditLog`
 * table) — no parallel audit system, per this module's own requirement.
 *
 * Deliberately does NOT subscribe to `DiscrepancyDetected`: a single run
 * can surface dozens of discrepancies, and every one of them is already
 * permanently preserved in `reconciliation_discrepancies` itself (Module
 * 80's own durable, queryable record — see that table's own doc comment
 * on why history is never deleted). Writing a second copy of the same
 * fact into `AuditLog` on every detection would be pure duplication and
 * would flood the admin audit trail with high-volume, structurally
 * redundant entries. Run-level lifecycle (an admin/operator needs to know
 * "a run happened, here's the summary") and discrepancy *resolution* (a
 * genuine admin decision) are the events worth a distinct audit trail
 * entry.
 */
export class RecordReconciliationRunAuditLogSubscriber
  implements EventHandler<ReconciliationRunStarted | ReconciliationRunCompleted | ReconciliationRunFailed>
{
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ReconciliationRunStarted | ReconciliationRunCompleted | ReconciliationRunFailed): Promise<void> {
    if (event instanceof ReconciliationRunStarted) {
      await this.auditLog.record({
        adminUserId: event.triggeredByUserId,
        action: "RECONCILIATION_RUN_STARTED",
        targetType: "ReconciliationRun",
        targetId: event.runId,
        metadata: { scope: event.scope },
      });
      return;
    }
    if (event instanceof ReconciliationRunCompleted) {
      await this.auditLog.record({
        adminUserId: null,
        action: "RECONCILIATION_RUN_COMPLETED",
        targetType: "ReconciliationRun",
        targetId: event.runId,
        metadata: {
          scope: event.scope,
          recordsInspected: event.recordsInspected,
          discrepancyCount: event.discrepancyCount,
          durationMs: event.durationMs,
        },
      });
      return;
    }
    if (event instanceof ReconciliationRunFailed) {
      await this.auditLog.record({
        adminUserId: null,
        action: "RECONCILIATION_RUN_FAILED",
        targetType: "ReconciliationRun",
        targetId: event.runId,
        metadata: { scope: event.scope, errorMessage: event.errorMessage, recordsInspected: event.recordsInspected },
      });
    }
  }
}

export class RecordDiscrepancyResolutionAuditLogSubscriber implements EventHandler<DiscrepancyResolved> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: DiscrepancyResolved): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.resolvedByUserId,
      action: "RECONCILIATION_DISCREPANCY_RESOLVED",
      targetType: "ReconciliationDiscrepancy",
      targetId: event.discrepancyId,
      metadata: { category: event.category, severity: event.severity },
    });
  }
}
