import "server-only";

import { isSentryConfigured } from "@/infrastructure/observability/sentry-client";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { SentryFailureReporter } from "@/infrastructure/observability/sentry-failure-reporter";
import { ConsoleFailureReporter } from "@/infrastructure/observability/console-failure-reporter";
import type { FailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 39 — Sentry + CI/CD Hardening.
 *
 * The single place every use-case `compose.ts` gets its `FailureReporter`
 * from, replacing each module's own `new ConsoleFailureReporter()` (Module
 * 37) with dependency injection: `SentryFailureReporter` when Sentry is
 * configured (production), `ConsoleFailureReporter` otherwise (local
 * development) — mirroring `error-reporter-factory.ts`'s
 * `createErrorReporter()` exactly.
 *
 * No use case or subscriber changes: every one of them already depends
 * only on the `FailureReporter` interface (`application/ports/failure-reporter.ts`),
 * never on this factory or on either concrete class directly.
 */
let instance: FailureReporter | null = null;

export function createFailureReporter(): FailureReporter {
  if (!instance) {
    instance = isSentryConfigured()
      ? new SentryFailureReporter(createErrorReporter())
      : new ConsoleFailureReporter();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
