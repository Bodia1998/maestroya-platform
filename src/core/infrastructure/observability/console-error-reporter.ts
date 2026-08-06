import "server-only";

import { logger } from "@/infrastructure/observability/logger";
import type { ErrorReportContext, ErrorReporter } from "@/application/ports/error-reporter";

/**
 * Module 39 — Sentry + CI/CD Hardening.
 *
 * The development-mode `ErrorReporter` (`application/ports/error-reporter.ts`)
 * implementation: routes through the existing structured `logger`
 * (`infrastructure/observability/logger.ts`, Module 25) instead of Sentry,
 * exactly the same role `ConsoleFailureReporter` plays for
 * `FailureReporter` (Module 37) — see that class's own doc comment.
 *
 * `error-reporter-factory.ts`'s `createErrorReporter()` is the only place
 * that decides between this and `SentryErrorReporter`; every call site
 * (Route Handlers, `http-error-response.ts`, `instrumentation.ts`) depends
 * only on the `ErrorReporter` interface.
 */
export class ConsoleErrorReporter implements ErrorReporter {
  reportException(error: unknown, context?: ErrorReportContext): void {
    logger.error("error-reporter.exception", { ...flattenContext(context), error });
  }

  reportMessage(message: string, context?: ErrorReportContext): void {
    logger.error("error-reporter.message", { ...flattenContext(context), message });
  }
}

function flattenContext(context?: ErrorReportContext): Record<string, unknown> {
  if (!context) return {};
  const { tags, extra, user } = context;
  return {
    ...(tags ? { tags } : {}),
    ...(extra ? { extra } : {}),
    ...(user !== undefined ? { user } : {}),
  };
}
