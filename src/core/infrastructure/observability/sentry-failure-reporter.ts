import "server-only";

import { logger } from "@/infrastructure/observability/logger";
import type { ErrorReporter } from "@/application/ports/error-reporter";
import type { FailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 39 — Sentry + CI/CD Hardening.
 *
 * The Sentry-backed `FailureReporter` (`application/ports/failure-reporter.ts`,
 * Module 37) implementation, exactly the drop-in replacement that port's
 * own doc comment describes: attaches `error.eventName`/`error.eventId`
 * (the shape every existing call site already passes as `context`, e.g.
 * `SuspendCompanyUseCase`) and — when `error` is an `EventDispatchError`
 * (`application/ports/event-dispatch-error.ts`) — its `failures` array, as
 * Sentry tags/context.
 *
 * Built on top of `ErrorReporter` (this module's own general-purpose
 * Sentry reporting port) rather than talking to the `@sentry/nextjs` SDK
 * directly — `SentryErrorReporter` already owns "how to safely get a
 * report to Sentry, falling back to the logger if that's not possible";
 * duplicating that here would be the same failure-handling logic
 * maintained twice.
 *
 * Still always logs through the structured `logger` too, exactly like
 * `ConsoleFailureReporter` did — an event-subscriber failure remains
 * visible in this process's own logs (for local `docker logs`/CI
 * debugging) in addition to being reported to Sentry, rather than one
 * replacing the other.
 *
 * Wired in by `failure-reporter-factory.ts`'s `createFailureReporter()` —
 * no use case or subscriber that depends on `FailureReporter` changes.
 */
export class SentryFailureReporter implements FailureReporter {
  constructor(private readonly errorReporter: ErrorReporter) {}

  report(error: unknown, context?: Record<string, unknown>): void {
    const { eventName, eventId, event, ...rest } = context ?? {};
    const failures = extractFailures(error);

    const tags: Record<string, string> = { source: "event-subscriber" };
    const name = eventName ?? event;
    if (typeof name === "string") tags.eventName = name;
    if (typeof eventId === "string") tags.eventId = eventId;

    this.errorReporter.reportException(error, {
      tags,
      extra: {
        ...rest,
        ...(failures ? { failures } : {}),
      },
    });

    // Same log event name ConsoleFailureReporter has always used. Built
    // from `rest`/`name`/`eventId` rather than spreading raw `context`:
    // every real call site passes `{ event: error.eventName, eventId }`
    // (see e.g. SuspendCompanyUseCase), and `logger`'s own `write()`
    // spreads caller-supplied fields *after* its own `event` parameter
    // (infrastructure/observability/logger.ts) — spreading a context
    // object that itself has an `event` key would silently overwrite the
    // logged event name ("event-subscriber.failure") with the caller's
    // event name instead. Renaming to `eventName` here avoids the
    // collision while preserving the same information.
    logger.error("event-subscriber.failure", {
      ...rest,
      ...(typeof name === "string" ? { eventName: name } : {}),
      ...(typeof eventId === "string" ? { eventId } : {}),
      error,
    });
  }
}

/**
 * `EventDispatchError` (Module 34) carries a `failures` array describing
 * every handler that threw. Read via duck-typing rather than an
 * `instanceof` check against the application-layer class — this file
 * only needs the one field, and this keeps
 * `infrastructure/observability/` from taking on a compile-time
 * dependency on that specific application-layer error type.
 */
function extractFailures(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    "failures" in error &&
    Array.isArray((error as { failures: unknown }).failures)
  ) {
    return (error as { failures: unknown }).failures;
  }
  return undefined;
}
