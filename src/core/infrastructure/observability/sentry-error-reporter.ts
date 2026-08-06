import "server-only";

import { logger } from "@/infrastructure/observability/logger";
import { getSentry } from "@/infrastructure/observability/sentry-client";
import type { ErrorReportContext, ErrorReporter } from "@/application/ports/error-reporter";

/**
 * Module 39 — Sentry + CI/CD Hardening.
 *
 * The production `ErrorReporter` (`application/ports/error-reporter.ts`)
 * implementation. Wraps every report in a Sentry scope so tags/extra
 * context/user are attached to that one event only, never leaked onto
 * whatever the SDK's ambient global scope happens to hold from a
 * different request — important in a long-lived Node.js server process
 * handling many concurrent requests.
 *
 * `report*` methods are synchronous per the `ErrorReporter` contract (a
 * reporting call site must never need to be awaited — see that
 * interface's own doc comment on "must itself never throw"), but the
 * underlying Sentry SDK load/init is asynchronous (`sentry-client.ts`).
 * Each call fires the async work and swallows any rejection itself
 * (`.catch()`), falling back to the structured `logger` so a Sentry-side
 * failure never means the failure goes unrecorded entirely.
 */
export class SentryErrorReporter implements ErrorReporter {
  reportException(error: unknown, context?: ErrorReportContext): void {
    void this.send("exception", error, context);
  }

  reportMessage(message: string, context?: ErrorReportContext): void {
    void this.send("message", message, context);
  }

  private async send(
    kind: "exception" | "message",
    payload: unknown,
    context?: ErrorReportContext,
  ): Promise<void> {
    try {
      const sentry = await getSentry();

      if (!sentry) {
        fallbackToLogger(kind, payload, context);
        return;
      }

      sentry.withScope((scope: SentryScope) => {
        if (context?.tags) {
          for (const [key, value] of Object.entries(context.tags)) scope.setTag(key, value);
        }
        if (context?.extra) {
          for (const [key, value] of Object.entries(context.extra)) scope.setExtra(key, value);
        }
        if (context && "user" in context) scope.setUser(context.user ?? null);

        if (kind === "exception") sentry.captureException(payload);
        else sentry.captureMessage(String(payload));
      });
    } catch (sendError) {
      // Reporting the error must never itself throw or reject unhandled —
      // fall back to the structured logger so the original failure is
      // still recorded somewhere, and log the reporting failure too.
      logger.error("sentry_report_failed", { sendError });
      fallbackToLogger(kind, payload, context);
    }
  }
}

/** Minimal shape this file relies on from Sentry's `Scope` type. */
interface SentryScope {
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
  setUser(user: { id?: string; email?: string } | null): void;
}

function fallbackToLogger(
  kind: "exception" | "message",
  payload: unknown,
  context?: ErrorReportContext,
): void {
  const fields = {
    ...(context?.tags ? { tags: context.tags } : {}),
    ...(context?.extra ? { extra: context.extra } : {}),
    ...(context && "user" in context ? { user: context.user } : {}),
  };
  if (kind === "exception") logger.error("error-reporter.exception", { ...fields, error: payload });
  else logger.error("error-reporter.message", { ...fields, message: payload });
}
