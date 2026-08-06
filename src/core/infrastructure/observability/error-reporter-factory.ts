import "server-only";

import { isSentryConfigured } from "@/infrastructure/observability/sentry-client";
import { SentryErrorReporter } from "@/infrastructure/observability/sentry-error-reporter";
import { ConsoleErrorReporter } from "@/infrastructure/observability/console-error-reporter";
import type { ErrorReporter } from "@/application/ports/error-reporter";

/**
 * Module 39 — Sentry + CI/CD Hardening.
 *
 * The single place that decides which `ErrorReporter` implementation a
 * given process gets: `SentryErrorReporter` when `SENTRY_DSN` is
 * configured (always true in production — see `env.ts`'s `superRefine`),
 * `ConsoleErrorReporter` otherwise (local development, and any test that
 * doesn't set `SENTRY_DSN`).
 *
 * A single memoized instance per process — both implementations are
 * stateless aside from the lazily-initialized Sentry SDK singleton
 * (`sentry-client.ts` itself already memoizes that), so there's no
 * correctness reason to construct more than one, and reusing one avoids
 * Route Handlers/`instrumentation.ts` each holding their own reference.
 */
let instance: ErrorReporter | null = null;

export function createErrorReporter(): ErrorReporter {
  if (!instance) {
    instance = isSentryConfigured() ? new SentryErrorReporter() : new ConsoleErrorReporter();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
