import type { EventHandler } from "@/application/ports/event-bus";
import type { ErrorReporter } from "@/application/ports/error-reporter";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DiscrepancyDetected } from "@/domain/events/discrepancy-detected";

/**
 * Module 90 — Automated Reconciliation & Financial Alerting.
 *
 * Turns a newly-detected CRITICAL discrepancy into an operational alert.
 * This is the piece Module 80/81 deliberately left out: that module
 * persists every discrepancy (with severity, resolution state, and full
 * dedup — see `ReconciliationDiscrepancyRepository`'s own doc comments)
 * and logs it (`reconciliation-observability.ts`), but nothing actually
 * pages an operator when a CRITICAL discrepancy — money already moved,
 * or could move, beyond what is owed (see `severity.ts`'s own doc
 * comment on what "CRITICAL" means here) — is found.
 *
 * ## Why this is alert-deduplicated for free
 * Subscribes only to `DiscrepancyDetected`, which — per that event's own
 * doc comment — fires exactly once per discrepancy: on first insertion
 * via `createOrTouch`, never on re-confirmation of an already-OPEN row
 * (`lastSeenRunId` is simply touched, no event). So a CRITICAL
 * discrepancy that is re-detected on every scheduled run for a week
 * generates exactly one alert, not one per run — no extra dedup state to
 * invent or maintain here. If an admin later resolves it and the same
 * underlying condition reappears, `createOrTouch` inserts a brand-new row
 * (`findOpenByFingerprint` only ever matches OPEN rows) and
 * `DiscrepancyDetected` fires again, correctly starting a new alert
 * cycle — exactly the "may generate a new alert cycle" behavior the
 * module spec asks for, with no code here even aware of resolution.
 *
 * Non-CRITICAL discrepancies do not alert here: still fully persisted
 * and visible on the admin dashboard (Module 81), just not paged — see
 * `severity.ts` for what separates a CRITICAL finding from an
 * ERROR/WARNING/INFO one.
 *
 * ## Failure isolation (never a second source of financial truth)
 * By the time this handler runs, the discrepancy this event describes is
 * already durably persisted (`StartReconciliationRunUseCase.persistCandidate`
 * calls `createOrTouch` and only *then* publishes `DiscrepancyDetected`).
 * This handler's own failure — `errorReporter`/`auditLog` unavailable —
 * can therefore never lose the discrepancy: it can only mean this one
 * alert wasn't delivered, which is exactly the class of failure the
 * platform's existing event-dispatch contract already isolates. A
 * throwing handler is caught by the event bus (`SynchronousEventBus`
 * wraps it in `EventDispatchError`; `publishDomainEvent` — the call site
 * in `StartReconciliationRunUseCase` — reports that via `FailureReporter`
 * and swallows it), so it never rolls back the discrepancy, never fails
 * the reconciliation run, and never prevents sibling handlers (e.g. the
 * audit-log subscribers) from running. When `EVENT_QUEUE_ENABLED=true`
 * the same failure instead becomes a retryable queued job — BullMQ-style
 * `attempts`/backoff (see `queued-event-bus.ts`) — which is this
 * platform's existing answer to "alert delivery must be retryable"; no
 * new retry machinery is introduced here.
 *
 * `errorReporter` (Sentry/`ErrorReporter`) is observability only, never
 * this alert's persistence — the module spec's own "do not make Sentry
 * the sole source of financial discrepancy state" requirement. The
 * `AdminAuditLogRepository` entry this handler also records is what
 * makes an individual alert admin-visible and queryable after the fact,
 * independent of whatever Sentry retains.
 */
export class AlertOnCriticalDiscrepancySubscriber implements EventHandler<DiscrepancyDetected> {
  constructor(
    private readonly errorReporter: ErrorReporter,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async handle(event: DiscrepancyDetected): Promise<void> {
    if (event.severity !== "CRITICAL") return;

    this.errorReporter.reportMessage(`Critical financial reconciliation discrepancy detected: ${event.category}`, {
      tags: {
        source: "reconciliation-alert",
        severity: event.severity,
        category: event.category,
        entityType: event.entityType,
      },
      extra: {
        discrepancyId: event.discrepancyId,
        runId: event.runId,
        entityId: event.entityId,
        jobId: event.jobId,
      },
    });

    await this.auditLog.record({
      adminUserId: null,
      action: "RECONCILIATION_CRITICAL_DISCREPANCY_ALERTED",
      targetType: "ReconciliationDiscrepancy",
      targetId: event.discrepancyId,
      metadata: {
        runId: event.runId,
        category: event.category,
        severity: event.severity,
        entityType: event.entityType,
        jobId: event.jobId,
      },
    });
  }
}
