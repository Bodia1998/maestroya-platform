import { PrismaClient } from "@prisma/client";

import { getReplicaClient } from "@/infrastructure/database/prisma/replica-clients";
import { getReadReplicaConfig, getReplicaRouterService } from "@/infrastructure/database/replica-router";
import { withReadReplicaRouting } from "@/infrastructure/database/prisma/read-replica-extension";
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
/**
 * Module 55 — Read Replicas: `withReadReplicaRouting` adds a second
 * `$extends`-based `$allOperations` hook — applied *after* tracing, so a
 * query that is routed to a replica is executed via that replica's own
 * (also traced) `PrismaClient` while a query that stays on the primary
 * keeps flowing through the tracing hook underneath — that transparently
 * sends eligible read-only queries to a healthy replica and returns the
 * client **completely untouched** when `READ_REPLICAS_ENABLED` is not
 * `"true"` (the default) or no replica is configured. Exactly like
 * tracing, this is the single instrumentation point: no repository, and
 * no caller of `prisma`, changes or can tell the difference. See
 * `infrastructure/database/prisma/read-replica-extension.ts` for why the
 * extension, rather than 40+ repository decorators.
 */
export const prisma =
  globalForPrisma.prisma ??
  withReadReplicaRouting(
    withPrismaTracing(
      new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      }),
    ),
    getReplicaRouterService(),
    (replicaId) => {
      const replica = getReadReplicaConfig().replicas.find((candidate) => candidate.replicaId === replicaId);
      if (!replica) {
        throw new Error(`Read-replica routing selected unknown replica id ${JSON.stringify(replicaId)}.`);
      }
      return getReplicaClient(replica);
    },
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
