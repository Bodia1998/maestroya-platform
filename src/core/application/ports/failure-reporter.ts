/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * A tiny seam for reporting a failure that must not interrupt the
 * operation that triggered it — today that means an `EventDispatchError`
 * (`application/ports/event-dispatch-error.ts`) caught around an
 * `eventBus.publish`/`publishAll` call after the primary business
 * operation already succeeded (see `SuspendCompanyUseCase`/
 * `ReactivateCompanyUseCase` for the call sites). A subscriber failing —
 * e.g. `NotifyCompanyStatusChangeSubscriber` unable to reach the
 * notification store — is real information an operator should see, but it
 * must never surface as a failed request to the admin who merely
 * suspended a company, and it must never roll back the state change that
 * already happened.
 *
 * Deliberately narrow: one method, no severity levels, no structured
 * query API — this is a *reporting* port, not a general logging
 * abstraction (`infrastructure/observability/logger.ts` already exists
 * for that, see `ConsoleFailureReporter`'s own doc comment for how the two
 * relate). Kept in the application layer, mirroring
 * `NotificationCreator`'s port/no-op-default pattern
 * (`application/ports/notification-creator.ts`): application code depends
 * only on this interface, never on `console`, `logger`, or (eventually)
 * Sentry directly.
 *
 * Module 39 (Sentry + CI/CD Hardening) is the planned upgrade path: a
 * `SentryFailureReporter` implementing this same interface — attaching
 * `error.eventName`/`error.eventId`/`error.failures` as Sentry
 * tags/context — is a drop-in replacement wired in exactly one place
 * (wherever `ConsoleFailureReporter` is constructed today, e.g.
 * `application/use-cases/admin/compose.ts`). No use case or subscriber
 * that depends on `FailureReporter` needs to change.
 */
export interface FailureReporter {
  /**
   * Reports `error` as having happened while reacting to `context`. Must
   * itself never throw — a failure-reporting call site is, by
   * construction, already inside a "something already went wrong, don't
   * make it worse" path; a reporter that could itself throw would defeat
   * the purpose of using this port instead of raw `console.error`/`throw`.
   */
  report(error: unknown, context?: Record<string, unknown>): void;
}

/**
 * No-op default — the safe fallback for any optional `FailureReporter`
 * constructor parameter, and the implementation used by unit tests that
 * don't care about failure reporting. Mirrors
 * `NullNotificationCreator`'s own doc comment and role exactly.
 */
export class NullFailureReporter implements FailureReporter {
  report(_error: unknown, _context?: Record<string, unknown>): void {
    // Intentionally does nothing.
  }
}
