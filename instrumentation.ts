/**
 * Next.js instrumentation hook (Module 25 — Production Infrastructure).
 *
 * `register()` runs exactly once, as early as possible, when the server
 * starts — before it accepts any request. Two things belong here rather
 * than scattered across the codebase:
 *
 *  1. **Startup environment validation.** Importing `env` triggers
 *     `env.ts`'s `parseEnv()` (via its module-level `export const env =
 *     parseEnv()`), which throws immediately if a required variable is
 *     missing or malformed in production. Several other modules already
 *     import `env` at their own load time (auth-config, the Stripe and
 *     Cloudinary clients), so this validation already happened
 *     implicitly by the time those modules were first touched — this
 *     hook just makes it happen deterministically at boot, with a clear
 *     log line, rather than depending on which route happens to be hit
 *     first.
 *  2. **Graceful shutdown.** Closes the Prisma connection pool on
 *     SIGTERM/SIGINT so in-flight queries are allowed to finish and
 *     connections are released cleanly, rather than the process being
 *     killed mid-query. Next.js itself already manages the HTTP
 *     server's own lifecycle correctly (this does not reimplement that);
 *     this only adds the one thing Next.js can't know about — this
 *     app's own database connection pool.
 *
 * Guarded to the Node.js runtime only: this file is also imported for
 * the Edge runtime (e.g. `middleware.ts`) in a Next.js build, where
 * `process` signal handling and a full Prisma client are unavailable and
 * unnecessary.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { env } = await import("@/infrastructure/config/env");
  const { logger } = await import("@/infrastructure/observability/logger");
  const { isSentryConfigured } = await import("@/infrastructure/observability/sentry-client");

  logger.info("app_startup", {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    sentryConfigured: isSentryConfigured(),
  });

  const { prisma } = await import("@/infrastructure/database/prisma/client");
  // Module 44 — Redis Infrastructure: `getRedisClient()` only ever
  // constructs a real `RedisClient` (and only ever connects lazily, on
  // first command) when `REDIS_URL` is configured — importing it here is
  // safe and side-effect-free in the common case (no Redis configured),
  // and gives the graceful-shutdown hook below a handle to close the
  // connection cleanly when it is.
  const { getRedisClient } = await import("@/infrastructure/cache/redis-client-factory");

  // Module 37 — Domain Event Subscribers: each module registers its own
  // `eventBus.subscribe(...)` calls as a side effect of importing its own
  // `compose.ts` (see `infrastructure/events/compose.ts`'s own doc
  // comment) — but that registration only actually runs once something
  // imports that file. Importing every compose.ts that registers a
  // subscriber here guarantees all of them are wired up deterministically
  // at boot, before any request can publish an event a subscriber should
  // react to — the same "don't depend on which route happens to be hit
  // first" rationale as the env-validation import above. Individual
  // publishing modules (e.g. `admin/compose.ts`) may still import a
  // subscribing module's `compose.ts` directly where correctness of that
  // one flow shouldn't depend on this hook having run first (see that
  // file's own comment) — this list is a deterministic-at-boot backstop,
  // not the only place registration happens.
  await import("@/application/use-cases/admin/compose");
  await import("@/application/use-cases/notification/compose");
  await import("@/application/use-cases/verification/compose");
  await import("@/application/use-cases/company-verification/compose");
  await import("@/application/use-cases/dispute/compose");
  await import("@/application/use-cases/support-ticket/compose");
  await import("@/application/use-cases/company-invitation/compose");
  await import("@/application/use-cases/company-membership/compose");
  await import("@/application/use-cases/gdpr/compose");
  // Module 48 — Real-Time System: registers the domain-event → realtime-
  // channel broadcast subscribers (dispute/service-request updates — see
  // that compose.ts's own doc comment for which events, and why not all of
  // them). Also imported directly by `/api/realtime/sse/route.ts` itself,
  // for the reason that route's own comment gives (Route Handlers can run
  // in contexts where this hook's timing is less certain) — importing here
  // too keeps this module consistent with every other subscriber-
  // registering compose file in this deterministic-at-boot list.
  await import("@/application/use-cases/realtime/compose");
  // Module 47 — CQRS Search Engine: this module's subscribers live in its
  // own composition root (`infrastructure/search/compose.ts`) rather than
  // under `application/use-cases/`, because that file also owns the
  // search-index queue and worker they enqueue into — but it registers
  // them exactly the same way, at import time, so it belongs in this same
  // deterministic-at-boot list. Importing it before `startBackgroundJobs()`
  // below is what guarantees the search-index worker is registered before
  // the runtime starts, rather than only once the first request happens to
  // touch search.
  await import("@/infrastructure/search/compose");
  // Module 50 — Analytics Dashboard: registers this module's (enqueue-
  // only) event subscribers as a side effect of import, exactly like
  // Module 47 above. The scheduled periodic refresh is *not* a side
  // effect of this import — see `registerScheduledAnalyticsRefresh()`'s
  // own doc comment for why it is called explicitly, below, immediately
  // before `startBackgroundJobs()`.
  const { registerScheduledAnalyticsRefresh } = await import("@/infrastructure/analytics/compose");

  // Module 45 — Background Jobs: starts every registered worker and the
  // job scheduler. Called after the subscriber-registering imports above
  // so the event worker (registered as a side effect of
  // `infrastructure/events/compose.ts`, itself imported transitively by
  // every module above) never reserves a job for a handler that hasn't
  // been subscribed yet. A no-op — no queues were ever registered — when
  // `EVENT_QUEUE_ENABLED` is unset, the default.
  const { startBackgroundJobs, shutdownBackgroundJobs } = await import("@/infrastructure/jobs/compose");
  // Module 50 — Analytics Dashboard: builds the analytics-refresh queue/
  // worker and registers the scheduled backstop with the shared
  // `JobScheduler` *before* `startBackgroundJobs()` runs, so the
  // scheduler's timer actually starts with this schedule already present
  // (see `BackgroundJobRuntime.start()`'s own "only starts the scheduler
  // if a schedule already exists" behavior).
  registerScheduledAnalyticsRefresh();
  startBackgroundJobs();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("app_shutdown_start", { signal });
    try {
      await prisma.$disconnect();
      // Stops every worker from claiming new jobs and waits for in-flight
      // jobs to finish, before the shared Redis connection they (and the
      // job store) depend on is closed below. Idempotent and safe even
      // when queued dispatch was never enabled.
      await shutdownBackgroundJobs();
      // Only closes an actual connection — getRedisClient() returns null
      // (and quit() is a safe no-op) when REDIS_URL was never configured.
      await getRedisClient()?.quit();
      logger.info("app_shutdown_complete", { signal });
    } catch (error) {
      logger.error("app_shutdown_error", { signal, error });
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * Module 39 — Sentry + CI/CD Hardening: Next.js's global error-reporting
 * hook (App Router, Next 13.4+/stable in 15) — invoked automatically for
 * any exception that escapes a Server Component, Route Handler, or
 * Server Action *without* already having been caught and turned into a
 * response by that code itself. This is the backstop for "some route
 * handler didn't get its own explicit reporting call updated" — the
 * primary, more precise reporting paths remain
 * `http-error-response.ts`'s `toHttpErrorResponse` (Route Handlers that
 * use it) and each Route Handler's own `catch` block (the health/ready,
 * user/language, and cron routes) — this hook exists in addition to
 * those, not instead of them, since it can't distinguish an intentionally
 * caught `DomainError` a route already handled and responded to (no
 * exception escapes in that case, so this hook never even runs) from one
 * that wasn't.
 *
 * Only reports `DomainError`s that *do* escape uncaught (a bug in a route
 * that forgot to catch one) — never treats "an error escaped" as
 * automatically "ignore because it might be expected"; `DomainError`
 * instances are still expected to be caught deliberately by the code that
 * throws them, per `domain/errors/domain-error.ts`'s own doc comment.
 * Filtering by `instanceof DomainError` here still matches the "only
 * unexpected exceptions reach Sentry" requirement for the normal case
 * where routes do catch their own domain errors.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { DomainError } = await import("@/domain/errors/domain-error");
  if (error instanceof DomainError) return;

  const { createErrorReporter } = await import("@/infrastructure/observability/error-reporter-factory");
  createErrorReporter().reportException(error, {
    tags: {
      source: "next-instrumentation",
      routePath: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
    },
    extra: { path: request.path, method: request.method },
  });
}
