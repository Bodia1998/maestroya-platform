import "server-only";

import type { ReplicaHealthThresholds } from "@/domain/entities/read-replica";
import type { ReadConsistencyPolicy } from "@/domain/services/read-consistency-policy";
import type { ReplicaSelectionStrategyName } from "@/domain/services/replica-selector";
import { env } from "@/infrastructure/config/env";

/**
 * Module 55 — Read Replicas.
 *
 * Turns the validated `READ_REPLICA_*`/`DATABASE_REPLICA_URLS`
 * environment variables into the one resolved shape the rest of this
 * module reads — the same "decide once, from the validated env, in a
 * single named place" role `resolveBackupConfig()` (Module 54) and
 * `resolveTracingConfig()` (Module 51) play for their own modules. Kept
 * separate from `compose.ts` so the *decision* ("is read-replica routing
 * on, with which replicas and policy?") is unit-testable without
 * constructing a `PrismaClient`, opening a connection, or extending
 * anything.
 */

export interface ReplicaConnectionConfig {
  /** Stable, order-derived id (`replica-0`, `replica-1`, ...) — never the connection string itself, which must not appear in logs or health reports. */
  readonly replicaId: string;
  readonly connectionString: string;
}

export interface ReadReplicaConfig {
  readonly enabled: boolean;
  readonly replicas: readonly ReplicaConnectionConfig[];
  readonly selectionStrategy: ReplicaSelectionStrategyName;
  readonly defaultConsistency: ReadConsistencyPolicy;
  readonly thresholds: ReplicaHealthThresholds;
  /** See `ReplicaRouterServiceOptions.maxHealthAgeMs`'s own doc comment. */
  readonly maxHealthAgeMs: number;
}

/**
 * Parses `DATABASE_REPLICA_URLS` — a comma-separated list of Postgres
 * connection strings, the same grammar
 * `tracing-config.ts`'s `parseExporterHeaders` and `cron-expression.ts`
 * already use for their own comma-separated fields. Blank entries
 * (`",,"`, leading/trailing commas, surrounding whitespace) are dropped
 * rather than producing an empty or malformed replica — an operational
 * convenience field, not a security boundary, so a trailing comma in a
 * `.env` file must degrade gracefully rather than fail startup.
 */
export function parseReplicaConnectionStrings(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function resolveReadReplicaConfig(): ReadReplicaConfig {
  const enabled = env.READ_REPLICAS_ENABLED === "true";
  const connectionStrings = enabled ? parseReplicaConnectionStrings(env.DATABASE_REPLICA_URLS) : [];

  return {
    // A `READ_REPLICAS_ENABLED=true` deployment with no parseable
    // connection strings behaves exactly like the disabled path — every
    // read routes to the primary — rather than constructing a
    // zero-replica router that would do the same thing less legibly.
    // `env.ts`'s own production `superRefine` check separately makes this
    // combination a hard startup failure in production; this function
    // stays total for every other environment (dev/test), the same
    // "decide once, degrade safely, never throw" rule
    // `resolveTracingConfig()`'s otlp-with-no-endpoint downgrade follows.
    enabled: enabled && connectionStrings.length > 0,
    replicas: connectionStrings.map((connectionString, index) => ({
      replicaId: `replica-${index}`,
      connectionString,
    })),
    selectionStrategy: env.READ_REPLICA_SELECTION_STRATEGY,
    defaultConsistency: {
      level: env.READ_REPLICA_DEFAULT_CONSISTENCY,
      maxStalenessMs: env.READ_REPLICA_MAX_STALENESS_MS,
    },
    thresholds: {
      failureThreshold: env.READ_REPLICA_FAILURE_THRESHOLD,
      recoveryThreshold: env.READ_REPLICA_RECOVERY_THRESHOLD,
      maxLagMs: env.READ_REPLICA_MAX_LAG_MS,
    },
    maxHealthAgeMs: env.READ_REPLICA_HEALTH_STALE_MS,
  };
}
