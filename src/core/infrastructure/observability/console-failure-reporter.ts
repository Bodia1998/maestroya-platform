import "server-only";

import { logger } from "@/infrastructure/observability/logger";
import type { FailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The default `FailureReporter` (`application/ports/failure-reporter.ts`)
 * implementation: routes through the existing structured `logger`
 * (`infrastructure/observability/logger.ts`, Module 25) rather than a raw
 * `console.error` call, so a subscriber failure shows up as the same
 * one-JSON-object-per-line shape every other piece of production
 * infrastructure already emits — not a free-form string a log aggregator
 * can't parse.
 *
 * This is *not* the Sentry integration itself — Module 39 introduces a
 * `SentryFailureReporter` that implements the same `FailureReporter`
 * interface and is swapped in wherever this class is constructed today
 * (see that port's own doc comment). This class is what makes that swap
 * possible without touching a single use case or subscriber in the
 * meantime: every caller already depends on `FailureReporter`, never on
 * this concrete class or on `logger` directly.
 */
export class ConsoleFailureReporter implements FailureReporter {
  report(error: unknown, context?: Record<string, unknown>): void {
    logger.error("event-subscriber.failure", { ...context, error });
  }
}
