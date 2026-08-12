import "server-only";

import { ReplicaRouterService } from "@/application/services/database/replica-router-service";
import { createReplicaSelector } from "@/domain/services/replica-selector";
import { resolveReadReplicaConfig, type ReadReplicaConfig } from "@/infrastructure/database/read-replica-config";

/**
 * Module 55 — Read Replicas.
 *
 * The single process-wide `ReplicaRouterService`, built once from the
 * validated env. Deliberately its own tiny module, imported by *both*
 * `infrastructure/database/prisma/client.ts` (to build the routing
 * extension) and `infrastructure/database/compose.ts` (to feed the
 * active health monitor and report `/api/health/ready`'s
 * `checks.readReplicas`) — carrying no dependency on `PrismaClient` or
 * anything that itself depends on `client.ts`, which is what keeps that
 * two-way relationship from becoming an import cycle. The same role
 * `infrastructure/tracing/compose.ts`'s `getTracer()` plays for
 * `withPrismaTracing` (Module 51): the client-construction file imports
 * *the decision*, never the other way around.
 */

let config: ReadReplicaConfig | null = null;
let router: ReplicaRouterService | null = null;

function getConfig(): ReadReplicaConfig {
  if (!config) config = resolveReadReplicaConfig();
  return config;
}

export function getReplicaRouterService(): ReplicaRouterService {
  if (!router) {
    const resolved = getConfig();
    router = new ReplicaRouterService({
      replicas: resolved.replicas.map((replica) => ({ replicaId: replica.replicaId })),
      selector: createReplicaSelector(resolved.selectionStrategy),
      thresholds: resolved.thresholds,
      defaultConsistency: resolved.defaultConsistency,
      maxHealthAgeMs: resolved.maxHealthAgeMs,
    });
  }
  return router;
}

/** The resolved replica connection configuration — read by `client.ts` to build `resolveReplicaClient`, and by `compose.ts` to build the default `ReplicaHealthChecker`. */
export function getReadReplicaConfig(): ReadReplicaConfig {
  return getConfig();
}

/** Exposed for tests only — drops both singletons so the next call rebuilds them from the current env. */
export const __testing = {
  reset(): void {
    config = null;
    router = null;
  },
};
