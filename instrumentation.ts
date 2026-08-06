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

  logger.info("app_startup", {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
  });

  const { prisma } = await import("@/infrastructure/database/prisma/client");

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

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("app_shutdown_start", { signal });
    try {
      await prisma.$disconnect();
      logger.info("app_shutdown_complete", { signal });
    } catch (error) {
      logger.error("app_shutdown_error", { signal, error });
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
