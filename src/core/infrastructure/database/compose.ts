import "server-only";

import { ReplicaHealthMonitorService } from "@/application/services/database/replica-health-monitor-service";
import type { ReplicaHealthChecker } from "@/application/ports/replica-health-checker";
import { collectReadReplicaHealth, DISABLED_READ_REPLICA_HEALTH, type ReadReplicaHealthReport } from "@/infrastructure/database/read-replica-health";
import { getReadReplicaConfig, getReplicaRouterService } from "@/infrastructure/database/replica-router";
import { disconnectReplicaClients } from "@/infrastructure/database/prisma/replica-clients";
import { PrismaReplicaHealthChecker } from "@/infrastructure/database/prisma-replica-health-checker";
import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 55 — Read Replicas.
 *
 * Composition root — the same manual, no-DI-container convention as
 * every other `compose.ts` in this codebase (`infrastructure/backup/compose.ts`,
 * `infrastructure/tracing/compose.ts`): module-level singletons, plain
 * exported factory functions, `__testing.reset()`, no reflection.
 *
 * This file owns exactly two things, deliberately — everything else
 * (the router itself, which client serves which query) is already owned
 * by `replica-router.ts` and `prisma/client.ts` respectively, imported
 * here rather than duplicated:
 *
 *  1. **The active health checker** — `getReplicaHealthChecker()`, the
 *     default `PrismaReplicaHealthChecker` wired to the primary `prisma`
 *     client and the resolved replica list. Swappable in tests via
 *     `__testing.setHealthChecker()`.
 *  2. **Health** — `getReadReplicaHealth()`, consumed by
 *     `/api/health/ready`. Refreshes every configured replica's health
 *     through `ReplicaHealthMonitorService` before reporting, so the
 *     endpoint always reflects a check that just ran — not a stale
 *     reading from whenever a query last happened to touch a replica.
 *
 * `disconnectReadReplicas()` closes every replica connection pool —
 * called from `instrumentation.ts`'s existing SIGTERM/SIGINT shutdown
 * hook, alongside `prisma.$disconnect()`.
 *
 * ## `READ_REPLICAS_ENABLED=false` (the default)
 * `getReadReplicaHealth()` still works and resolves immediately —
 * `ReplicaRouterService.isEnabled` is `false`, so no ping is issued and
 * `DISABLED_READ_REPLICA_HEALTH` is returned directly, the same "a
 * disabled module's read paths stay honest and cheap" convention
 * `getBackupHealth()`/`getRecoveryHealth()` establish for Module 54.
 */

let healthChecker: ReplicaHealthChecker | null = null;

function getHealthChecker(): ReplicaHealthChecker {
  if (!healthChecker) {
    healthChecker = new PrismaReplicaHealthChecker(prisma, getReadReplicaConfig().replicas);
  }
  return healthChecker;
}

export async function getReadReplicaHealth(): Promise<ReadReplicaHealthReport> {
  const router = getReplicaRouterService();
  if (!router.isEnabled) return DISABLED_READ_REPLICA_HEALTH;

  const monitor = new ReplicaHealthMonitorService(getHealthChecker(), router);
  const { primaryHealthy } = await monitor.refresh();

  return collectReadReplicaHealth(router.snapshot(), primaryHealthy);
}

/**
 * Closes every replica connection pool. Idempotent, and safe to call
 * when read-replica routing was never enabled — both matter because
 * `instrumentation.ts` invokes it unconditionally from SIGTERM/SIGINT.
 */
export async function disconnectReadReplicas(): Promise<void> {
  await disconnectReplicaClients();
}

/** Exposed for tests only. */
export const __testing = {
  reset(): void {
    healthChecker = null;
  },
  setHealthChecker(checker: ReplicaHealthChecker): void {
    healthChecker = checker;
  },
};
