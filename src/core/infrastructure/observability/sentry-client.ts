import "server-only";

import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
// Type-only import — never triggers an actual module load (see the
// dynamic `import()` calls below, which are the only place this module
// is loaded at runtime).
import type * as SentryNamespace from "@sentry/nextjs";

/**
 * Module 39 — Sentry + CI/CD Hardening.
 *
 * The single place that knows how to load and initialize the `@sentry/nextjs`
 * SDK. `SentryErrorReporter`/`SentryFailureReporter` both call
 * `getSentry()` rather than importing `@sentry/nextjs` themselves — this
 * keeps SDK initialization idempotent (called at most once per process)
 * and keeps every other file that reports errors agnostic of *how*
 * Sentry gets initialized.
 *
 * `@sentry/nextjs` is imported dynamically, never at module top-level:
 *  - `isSentryConfigured()` (driven entirely by `SENTRY_DSN`) is `false`
 *    for the overwhelming majority of local dev/test runs, so the SDK is
 *    never loaded (and does not need to be installed) in that case.
 *  - A dynamic `import()` also means a genuinely missing/broken install
 *    of the package degrades to "Sentry reporting silently unavailable,
 *    fall back to console" (see the `.catch()` below) instead of crashing
 *    the whole application at startup — Sentry going down must never take
 *    the rest of the app with it.
 *
 * No business logic imports this module directly — only the
 * `ErrorReporter`/`FailureReporter` Sentry implementations do.
 */

// See `infrastructure/observability/types/sentry-nextjs-ambient.d.ts`'s own
// doc comment for how this type resolves when the real package isn't
// installed.
type SentryModule = typeof SentryNamespace;

let sentryModulePromise: Promise<SentryModule | null> | null = null;
let initialized = false;

/**
 * Whether this environment has enough configuration for Sentry to be
 * meaningfully enabled. `env.ts`'s production `superRefine` already
 * guarantees `SENTRY_DSN` is set whenever `NODE_ENV === "production"`
 * (outside the Next.js build phase) — this function is the single
 * runtime source of truth other modules (the reporter factories,
 * `instrumentation.ts`) check rather than re-deriving the same
 * environment condition independently.
 */
export function isSentryConfigured(): boolean {
  return Boolean(env.SENTRY_DSN);
}

/**
 * Resolves to the initialized `@sentry/nextjs` module, or `null` if
 * Sentry isn't configured or failed to load/initialize. Safe to call
 * repeatedly and concurrently — the underlying `import()`/`init()` only
 * ever runs once per process.
 */
export async function getSentry(): Promise<SentryModule | null> {
  if (!isSentryConfigured()) return null;

  if (!sentryModulePromise) {
    sentryModulePromise = import("@sentry/nextjs")
      .then((mod) => {
        if (!initialized) {
          mod.init({
            dsn: env.SENTRY_DSN,
            environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
            tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? 0,
          });
          initialized = true;
          logger.info("sentry_initialized", { environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV });
        }
        return mod;
      })
      .catch((error: unknown) => {
        // Sentry failing to load/initialize must never crash the app or
        // prevent it from starting — log once, server-side, and every
        // subsequent report call falls back to its console implementation
        // (see SentryErrorReporter/SentryFailureReporter's own fallback
        // paths).
        logger.error("sentry_init_failed", { error });
        return null;
      });
  }

  return sentryModulePromise;
}

/** Exposed for tests only — resets the memoized module/init state. */
export const __testing = {
  reset(): void {
    sentryModulePromise = null;
    initialized = false;
  },
};
