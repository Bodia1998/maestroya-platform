import type { PrismaClient } from "@prisma/client";

import type { ReplicaRouterService } from "@/application/services/database/replica-router-service";
import { getCurrentReadConsistency } from "@/infrastructure/database/read-consistency-context";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 55 — Read Replicas — the database.
 *
 * Routes **every** eligible read-only Prisma model operation to a
 * healthy replica, transparently, by extending the primary client at the
 * one point where it is constructed (`infrastructure/database/prisma/client.ts`)
 * — the identical technique `withPrismaTracing` (Module 51) already
 * established for this codebase, applied to a different concern.
 *
 * ## Why `$extends`, and why not a repository decorator
 * There are 40+ `Prisma*Repository` classes in
 * `infrastructure/database/prisma/repositories/`. Instrumenting them
 * individually to pick a client would mean 40+ call sites to write and
 * keep in sync with every future repository — and would still miss any
 * ad hoc `$queryRaw` outside a repository. `$extends`'s `$allOperations`
 * hook sits underneath all of them: one function, total coverage, and
 * **not one repository file is touched** — same constraint, same
 * solution as Module 51.
 *
 * ## What is eligible
 * Only the read-only model delegate methods in `READ_OPERATIONS` below
 * (`findUnique`, `findMany`, `count`, `aggregate`, `groupBy`, ...) are
 * ever considered for replica routing. Everything else — every write
 * method, `$queryRaw`/`$executeRaw`/`$transaction` (which report
 * `model: undefined` to `$allOperations` and are therefore
 * indistinguishable from each other here) — always executes on the
 * primary. This is a deliberately conservative boundary: raw SQL can be
 * a read or a write and this hook has no reliable way to tell the
 * difference, so "when in doubt, use the primary" is the only safe
 * default for a production system, exactly like `ReplicaRouterService.route`
 * treats `STRONG` consistency and an empty replica set.
 *
 * ## Routing, and mid-flight fallback
 * For an eligible read, `ReplicaRouterService.route("read", consistency)`
 * — where `consistency` is whatever `getCurrentReadConsistency()`
 * (`read-consistency-context.ts`) currently has active, or the
 * module-wide default when nothing is — decides `"primary"` or
 * `"replica"`. A `"replica"` decision executes the *same* operation
 * directly against that replica's own `PrismaClient` (`resolveReplicaClient`),
 * reusing that client's own model delegate rather than Prisma's internal
 * query engine plumbing — the same approach Prisma's own official
 * `@prisma/extension-read-replicas` package documents for this exact
 * problem. Success is folded back into the router
 * (`recordSuccess`) so its health state reflects real traffic, not only
 * active pings. A **failure at that replica** — a connection drop, a
 * query timeout, anything — is caught, recorded (`recordFailure`, which
 * may trip the replica to `UNHEALTHY` for the *next* decision), logged,
 * and retried once against the primary via the original `query(args)`
 * callback. The caller — a repository, a use case — never sees the
 * replica failure at all; the request that triggered it simply pays one
 * extra round trip.
 *
 * ## Never a source of failure
 * Any unexpected error in the routing logic itself (not the query — the
 * *decision*, e.g. a bug in `resolveReplicaClient`) is caught and treated
 * exactly like a replica query failure: log it, fall back to
 * `query(args)`. Read-replica routing is a performance optimization; a
 * bug in it must never be the reason a read fails, the same "a cache is
 * never allowed to be the reason a request fails" contract
 * `CacheProvider.get` already states for its own layer.
 *
 * ## Disabled path
 * `withReadReplicaRouting` returns the client completely untouched when
 * `router.isEnabled` is `false` (`READ_REPLICAS_ENABLED` unset, or set
 * with no configured replicas — the default either way) — no extension,
 * no proxy, no per-query branch, mirroring `withPrismaTracing`'s own
 * disabled-path guarantee exactly.
 */

/**
 * The read-only Prisma model delegate methods eligible for replica
 * routing. Deliberately excludes `findUniqueOrThrow`/`findFirstOrThrow`'s
 * throwing behavior from changing anything here — they still read-only,
 * and the thrown `NotFoundError` on a genuine miss is identical whichever
 * connection served it.
 */
export const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** `"User"` -> `"user"` — Prisma's model-delegate property naming on a client instance. */
export function toDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export function withReadReplicaRouting<TClient extends PrismaClient>(
  client: TClient,
  router: ReplicaRouterService,
  resolveReplicaClient: (replicaId: string) => PrismaClient,
): TClient {
  // Disabled: the client is returned exactly as constructed — no
  // extension, no proxy, no per-query closure. Mirrors
  // `withPrismaTracing`'s own `!tracer.enabled` early return.
  if (!router.isEnabled) return client;

  const extended = client.$extends({
    name: "maestroya-read-replicas",
    query: {
      $allOperations({ model, operation, args, query }) {
        if (!model || !READ_OPERATIONS.has(operation)) {
          return query(args);
        }

        const decision = router.route("read", getCurrentReadConsistency() ?? undefined);
        if (decision.target === "primary") {
          return query(args);
        }

        return routeToReplica({ model, operation, args, query, decision, router, resolveReplicaClient });
      },
    },
  });

  // `$extends` returns a structurally-different (branded) client type —
  // see `withPrismaTracing`'s own doc comment for the full explanation.
  // Identical, deliberate cast, confined to this one line.
  return extended as unknown as TClient;
}

export interface RouteToReplicaParams {
  readonly model: string;
  readonly operation: string;
  readonly args: unknown;
  readonly query: (args: unknown) => Promise<unknown>;
  readonly decision: { readonly target: "replica"; readonly replicaId: string; readonly reason: string };
  readonly router: ReplicaRouterService;
  readonly resolveReplicaClient: (replicaId: string) => PrismaClient;
}

/**
 * Exported (rather than kept module-private) specifically so
 * `tests/unit/.../read-replica-extension.test.ts` can exercise the
 * routing/fallback/health-recording behavior directly, against fakes, without
 * driving it through a real `PrismaClient`'s own `$extends` machinery —
 * the same reasoning `parseExporterHeaders` (Module 51) is exported
 * separately from `resolveTracingConfig`.
 */
export async function routeToReplica({ model, operation, args, query, decision, router, resolveReplicaClient }: RouteToReplicaParams): Promise<unknown> {
  const startedAt = Date.now();

  try {
    const replicaClient = resolveReplicaClient(decision.replicaId);
    const delegate = (replicaClient as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[toDelegateName(model)];
    const method = delegate?.[operation];
    if (!method) {
      throw new Error(`Replica client has no delegate method ${toDelegateName(model)}.${operation}.`);
    }
    const result = await method(args);

    router.recordSuccess(decision.replicaId, Date.now() - startedAt);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    router.recordFailure(decision.replicaId, message);

    logger.warn("read_replica_query_failed_falling_back_to_primary", {
      replicaId: decision.replicaId,
      model,
      operation,
      error: message,
    });

    return query(args);
  }
}
