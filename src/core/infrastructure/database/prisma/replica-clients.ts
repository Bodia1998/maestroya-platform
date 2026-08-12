import "server-only";

import { PrismaClient } from "@prisma/client";

import type { ReplicaConnectionConfig } from "@/infrastructure/database/read-replica-config";
import { withPrismaTracing } from "@/infrastructure/tracing/prisma-tracing";

/**
 * Module 55 — Read Replicas.
 *
 * Constructs and memoizes one `PrismaClient` per configured replica —
 * each its own connection pool, exactly like the primary `prisma`
 * singleton in `client.ts`. Every replica client is passed through
 * `withPrismaTracing` too, for the identical reason the primary client
 * is: a query the `$extends` hook in `read-replica-extension.ts` routes
 * to a replica must be traced exactly like one that stays on the
 * primary, and `withPrismaTracing` already returns the client completely
 * untouched when `TRACING_ENABLED` is not `"true"` — this file adds no
 * new "is tracing on?" branch of its own.
 *
 * Kept in its own module, separate from `client.ts`, because
 * `client.ts` is imported unconditionally by every one of the 40+
 * `Prisma*Repository` classes and must stay exactly as inexpensive to
 * import as it is today (Module 55 is opt-in). This file is only ever
 * imported from `infrastructure/database/compose.ts`, and only when
 * `READ_REPLICAS_ENABLED=true` resolves at least one configured replica.
 */

const clients = new Map<string, PrismaClient>();

/** Builds (once) or returns the memoized `PrismaClient` for the given replica. */
export function getReplicaClient(replica: ReplicaConnectionConfig): PrismaClient {
  const existing = clients.get(replica.replicaId);
  if (existing) return existing;

  const client = withPrismaTracing(
    new PrismaClient({
      datasources: { db: { url: replica.connectionString } },
      // Module 55 replicas are read-only by construction (the
      // `$extends` hook never routes a write operation to one) — query
      // logging follows the same convention `client.ts` uses for the
      // primary, so a developer debugging replica routing locally sees
      // exactly which statements ran against which connection.
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    }),
  );

  clients.set(replica.replicaId, client);
  return client;
}

/**
 * Closes every replica connection pool. Called from
 * `infrastructure/database/compose.ts`'s `disconnectReadReplicas()`,
 * itself called from `instrumentation.ts`'s existing SIGTERM/SIGINT
 * shutdown hook alongside `prisma.$disconnect()` — a replica connection
 * left open on shutdown is exactly the same class of leak the primary
 * client's own disconnect call already exists to prevent.
 */
export async function disconnectReplicaClients(): Promise<void> {
  await Promise.allSettled([...clients.values()].map((client) => client.$disconnect()));
  clients.clear();
}

/** Exposed for tests only. */
export const __testing = {
  get size(): number {
    return clients.size;
  },
  reset(): void {
    clients.clear();
  },
};
