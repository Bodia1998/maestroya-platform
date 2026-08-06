/**
 * Module 39 — Sentry + CI/CD Hardening.
 *
 * A tiny seam for reporting an *unexpected* exception (or a standalone
 * diagnostic message) to whatever error-monitoring backend the current
 * environment is configured with — today that means Sentry in production
 * and nothing in local development — without any application-layer code
 * ever depending on the Sentry SDK directly.
 *
 * Deliberately narrow and read-only from the application's perspective:
 * two report methods, no query API, no way to read back what was
 * reported. Application code (Server Actions, use cases, Route Handlers)
 * depends only on this interface; `infrastructure/observability/` owns
 * every concrete implementation (`ConsoleErrorReporter`,
 * `SentryErrorReporter`).
 *
 * Distinct from `FailureReporter` (`application/ports/failure-reporter.ts`,
 * Module 37), which is deliberately narrower still — one method, no
 * context shape beyond a plain record — because it exists solely for the
 * one "a domain event subscriber failed" case. `ErrorReporter` is the
 * general-purpose port every other unexpected-failure call site (Route
 * Handlers today; background jobs and any future BullMQ worker) should
 * use. `SentryFailureReporter` (the Module 37 port's Sentry
 * implementation) is itself built on top of this port rather than
 * duplicating Sentry SDK calls — see that class's own doc comment.
 */

/**
 * Structured metadata attached to a single report. All fields optional —
 * a caller with nothing more than the error itself can just omit this
 * argument entirely (see `NullErrorReporter`/`ConsoleErrorReporter`
 * below for the "no context supplied" case).
 */
export interface ErrorReportContext {
  /** Free-text/short-code labels Sentry can filter/group issues by. */
  tags?: Record<string, string>;
  /** Arbitrary structured data attached to the report but not indexed. */
  extra?: Record<string, unknown>;
  /**
   * The user associated with the request that triggered this report, if
   * any. `null` explicitly clears any previously associated user (rarely
   * needed outside long-lived worker contexts); `undefined`/omitted
   * leaves user context untouched.
   */
  user?: { id?: string; email?: string } | null;
}

export interface ErrorReporter {
  /**
   * Reports an unexpected exception. Must itself never throw — exactly
   * like `FailureReporter.report`, a reporting call site is by
   * construction already inside a "something already went wrong" path.
   *
   * Callers must never pass an *expected* failure here — a `DomainError`
   * (`domain/errors/domain-error.ts`) representing an ordinary validation
   * failure, a not-found lookup, etc. is not a bug and must not consume
   * Sentry's error budget or page anyone. See
   * `infrastructure/observability/http-error-response.ts` for the
   * canonical "only the unexpected branch reports" example.
   */
  reportException(error: unknown, context?: ErrorReportContext): void;

  /**
   * Reports a standalone diagnostic message with no associated exception
   * object — e.g. "Sentry configuration is valid but the SDK failed to
   * initialize", or a future BullMQ worker noting a job was abandoned
   * after exhausting retries without throwing.
   */
  reportMessage(message: string, context?: ErrorReportContext): void;
}

/**
 * No-op default — the safe fallback for any optional `ErrorReporter`
 * constructor parameter and for unit tests that don't care about error
 * reporting. Mirrors `NullFailureReporter`'s role exactly.
 */
export class NullErrorReporter implements ErrorReporter {
  reportException(_error: unknown, _context?: ErrorReportContext): void {
    // Intentionally does nothing.
  }

  reportMessage(_message: string, _context?: ErrorReportContext): void {
    // Intentionally does nothing.
  }
}
