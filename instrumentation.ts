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
