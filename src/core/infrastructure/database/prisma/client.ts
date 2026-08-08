import { PrismaClient } from "@prisma/client";

import { withPrismaTracing } from "@/infrastructure/tracing/prisma-tracing";

/**
 * Prisma client singleton.
 *
 * In development, Next.js hot-reloads modules, which would otherwise create
 * a new PrismaClient (and a new DB connection pool) on every edit. Caching
 * the instance on `globalThis` avoids exhausting the Postgres connection
 * limit. This is the standard pattern recommended by Prisma for Next.js.
 *
 * This file lives in infrastructure — domain and application code must
 * never import PrismaClient directly. They depend on repository
 * *interfaces* defined in `src/core/domain/repositories`; concrete Prisma
 * repository implementations (in this same infrastructure layer) are the
 * only code allowed to import this client.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Module 51 — Distributed Tracing: `withPrismaTracing` adds a
 * `$extends`-based `$allOperations` hook that wraps every query in a
 * `client` span, and returns the client **completely untouched** when
 * `TRACING_ENABLED` is not `"true"` (the default). This is the single
 * instrumentation point for the database — no repository, and no caller
 * of `prisma`, changes or can tell the difference; the exported symbol's
 * type is identical either way. See `infrastructure/tracing/prisma-tracing.ts`
 * for why the extension, rather than 40+ repository decorators or
 * Prisma's own preview-flagged instrumentation package.
 */
export const prisma =
  globalForPrisma.prisma ??
  withPrismaTracing(
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    }),
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
