# Module 55 — Read Replicas

## 1. What this module is

A production-grade read/write database-routing layer built entirely as
Clean Architecture abstractions, so the concrete replica topology
(zero replicas, one, or many; round-robin or lag-aware selection) can
change without touching a single line of business logic — the same
"swappable, provider-based, zero technical debt" bar Modules 44, 46, 51
and 54 already set for this codebase.

Five concrete capabilities:

1. **Read/write separation** — every write, and every raw SQL statement,
   always executes on the primary. Only the read-only Prisma model
   delegate methods (`findMany`, `findUnique`, `count`, `aggregate`,
   `groupBy`, ...) are ever eligible for replica routing.
2. **Replica selection strategy** — a swappable `ReplicaSelector`
   (`ROUND_ROBIN` default, `RANDOM`, `LEAST_LAG`) picks which healthy
   replica serves an eligible read.
3. **Read consistency strategy** — `STRONG` (primary only), `EVENTUAL`
   (any healthy replica, default), or `BOUNDED_STALENESS` (a replica
   only within a configured lag bound) — settable module-wide via env,
   or per call site via `withReadConsistency()`.
4. **Health monitoring & automatic fallback** — a circuit-breaker health
   state machine per replica, fed by both real query outcomes and an
   active on-demand health check, with a replica that fails or lags
   excluded from routing until it recovers — transparently, mid-request,
   with zero caller-visible failure.
5. **Health & monitoring integration** — one new check
   (`checks.readReplicas`) joining `/api/health/ready`'s existing
   "operational visibility only" category.

`READ_REPLICAS_ENABLED` (default `false`) is the module's single kill
switch — see §7.

## 2. Architecture

```
domain/entities/
  read-replica.ts                    — ReplicaHealth (circuit-breaker
                                        state machine), ReplicationLag
domain/services/
  replica-selector.ts                — ReplicaSelector +
                                        RoundRobin/Random/LeastLag
  read-consistency-policy.ts         — ReadConsistencyLevel,
                                        permitsReplicaRead()

application/ports/
  replica-health-checker.ts          — ReplicaHealthChecker
application/services/database/
  replica-router-service.ts          — ReplicaRouterService (routing +
                                        fallback + health bookkeeping)
  replica-health-monitor-service.ts  — active health-check orchestration

infrastructure/database/
  read-replica-config.ts             — resolveReadReplicaConfig() from env
  replica-router.ts                  — the process-wide ReplicaRouterService
                                        singleton (shared by client.ts and
                                        compose.ts)
  read-consistency-context.ts        — withReadConsistency()/
                                        getCurrentReadConsistency()
                                        (AsyncLocalStorage)
  prisma-replica-health-checker.ts   — default ReplicaHealthChecker
                                        (Postgres/Prisma-specific)
  read-replica-health.ts             — collectReadReplicaHealth()
  compose.ts                         — composition root
  prisma/
    replica-clients.ts               — one PrismaClient per replica
    read-replica-extension.ts        — the $extends routing hook

app/api/health/ready/route.ts        — checks.readReplicas
instrumentation.ts                   — disconnectReadReplicas() on shutdown
```

No DI container; every dependency is wired by hand in `compose.ts`
(and, for the two singletons `client.ts` and `compose.ts` both need,
in the smaller `replica-router.ts`), the same convention every prior
module follows.

## 3. Read/write separation and routing

Routing happens at exactly one point: `read-replica-extension.ts`'s
`withReadReplicaRouting()`, a Prisma `$extends`-based `$allOperations`
hook applied to the primary `PrismaClient` in `prisma/client.ts` —
the identical technique `withPrismaTracing` (Module 51) already
established for this codebase, applied to a different concern. This is
what makes routing **transparent**: not one of the 40+
`Prisma*Repository` classes, and no use case above them, imports
anything from this module or knows a replica exists.

Only the methods in `READ_OPERATIONS`
(`findUnique[OrThrow]`, `findFirst[OrThrow]`, `findMany`, `count`,
`aggregate`, `groupBy`) are ever considered. Every write method, and
every raw query (`$queryRaw`/`$executeRaw`/`$transaction` — which
report `model: undefined` to `$allOperations` and are therefore
indistinguishable from each other) always executes on the primary. This
is a deliberately conservative boundary: raw SQL can be a read or a
write, and guessing wrong in either direction is unacceptable in
production — "when in doubt, use the primary" is the only safe default.

For an eligible read, `ReplicaRouterService.route("read", consistency)`
decides `"primary"` or `"replica"`. A `"replica"` decision executes the
identical operation directly against that replica's own `PrismaClient`
(one connection pool per replica, built lazily by
`prisma/replica-clients.ts`, each also wrapped in `withPrismaTracing` so
a replica-served query is traced exactly like a primary-served one) —
reusing that client's own model delegate, the same approach Prisma's own
official `@prisma/extension-read-replicas` package documents for this
exact problem, rather than depending on that package directly (kept
in-house so the routing/health/fallback/consistency logic stays fully
owned, tested, and Clean-Architecture-layered rather than living inside
a third-party black box).

## 4. Replica selection strategy

`domain/services/replica-selector.ts` defines three pure, swappable
`ReplicaSelector` implementations, selected via
`READ_REPLICA_SELECTION_STRATEGY`:

- **`ROUND_ROBIN`** (default) — cycles through eligible candidates in
  order, one step per call. Fair distribution, no lag awareness.
- **`RANDOM`** — uniform random pick; `random` is injectable for
  deterministic tests.
- **`LEAST_LAG`** — picks the candidate with the lowest known
  replication lag; a candidate with no lag reading yet sorts last.

Adding a fourth strategy means implementing the three-method
`ReplicaSelector` interface and adding one case to
`createReplicaSelector()` — no change to `ReplicaRouterService`,
the extension, or anything above it.

## 5. Read consistency strategy

`domain/services/read-consistency-policy.ts`'s `ReadConsistencyLevel`:

- **`STRONG`** — never eligible for a replica; every read goes to the
  primary. The correct choice for a read that must observe a write the
  same request just made (the classic replication-lag read-your-own-
  writes hazard).
- **`EVENTUAL`** (default) — any healthy replica is acceptable
  regardless of lag. The only choice that actually offloads read
  traffic from the primary in the common case.
- **`BOUNDED_STALENESS`** — a replica is acceptable only if its most
  recently observed lag is within `READ_REPLICA_MAX_STALENESS_MS`.

`READ_REPLICA_DEFAULT_CONSISTENCY` sets the module-wide default. A
specific call site can require a stricter level for the reads it makes
— without changing any repository's method signature — via
`infrastructure/database/read-consistency-context.ts`'s
`withReadConsistency({ level: "STRONG", maxStalenessMs: 0 }, () => { ... })`,
built on Node's `AsyncLocalStorage`, the same non-invasive propagation
technique `TracingPort`'s active-span context already uses.

## 6. Health monitoring and automatic fallback

Each replica's health is a `ReplicaHealth` circuit-breaker state machine
(`domain/entities/read-replica.ts`): `UNKNOWN` → `HEALTHY` on first
success; `HEALTHY` → `DEGRADED` on any single failure (one blip is not
an outage — still eligible for routing); `DEGRADED`/`HEALTHY` →
`UNHEALTHY` after `READ_REPLICA_FAILURE_THRESHOLD` consecutive failures,
or immediately when a lag reading exceeds `READ_REPLICA_MAX_LAG_MS`
(excluded from routing until it recovers); `UNHEALTHY` → `HEALTHY` after
`READ_REPLICA_RECOVERY_THRESHOLD` consecutive successes. A replica whose
last signal is older than `READ_REPLICA_HEALTH_STALE_MS` is treated as
ineligible regardless of its last known state.

Two independent sources feed this state, both folding into the same
`ReplicaRouterService`:

- **Passive** — every organic query the `$extends` hook routes to a
  replica reports its own success/failure back
  (`recordSuccess`/`recordFailure`), so a replica that fails a live
  query becomes ineligible for the *very next* decision, without
  waiting for a scheduled check.
- **Active** — `ReplicaHealthMonitorService.refresh()` pings every
  configured replica (and the primary) through the injected
  `ReplicaHealthChecker` port. The default `PrismaReplicaHealthChecker`
  measures round-trip latency via a trivial `SELECT 1` and replication
  lag via Postgres's own `pg_last_xact_replay_timestamp()`. Invoked
  on-demand by `compose.ts`'s `getReadReplicaHealth()` — itself called
  every time `/api/health/ready` is hit — rather than a background
  interval timer: this codebase's periodic work runs on Module 45's
  `JobScheduler` (queue + worker, Redis-backed in production), the
  wrong tool for a check that must also run correctly in a serverless
  deployment where no process outlives a single request. A production
  load-balancer/orchestrator readiness probe (typically every few
  seconds) is what keeps this genuinely fresh in practice.

**Fallback** is baked into `ReplicaRouterService.route()` itself, not a
separate error branch: `STRONG` consistency, an empty replica set, or a
moment where every replica is ineligible all resolve to
`{ target: "primary" }` through the identical code path. The extension
additionally falls back *mid-flight* — a chosen replica's actual query
throwing is caught, recorded as a failure, logged
(`read_replica_query_failed_falling_back_to_primary`), and retried once
against the primary. The caller never sees the replica failure; the
request simply pays one extra round trip.

## 7. Configuration (`env.ts`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `READ_REPLICAS_ENABLED` | `false` | Module kill switch. |
| `DATABASE_REPLICA_URLS` | `""` | Comma-separated Postgres connection strings, one per replica. |
| `READ_REPLICA_SELECTION_STRATEGY` | `ROUND_ROBIN` | `ROUND_ROBIN` \| `RANDOM` \| `LEAST_LAG`. |
| `READ_REPLICA_DEFAULT_CONSISTENCY` | `EVENTUAL` | `STRONG` \| `EVENTUAL` \| `BOUNDED_STALENESS`. |
| `READ_REPLICA_MAX_STALENESS_MS` | `5000` | Only for `BOUNDED_STALENESS`. |
| `READ_REPLICA_MAX_LAG_MS` | `30000` | Hard ceiling — beyond this a replica is `UNHEALTHY` regardless of consistency level. |
| `READ_REPLICA_FAILURE_THRESHOLD` | `3` | Consecutive failures before `UNHEALTHY`. |
| `READ_REPLICA_RECOVERY_THRESHOLD` | `2` | Consecutive successes before returning to `HEALTHY`. |
| `READ_REPLICA_HEALTH_STALE_MS` | `60000` | A signal older than this is treated as ineligible. |

Every field but `DATABASE_REPLICA_URLS` uses `.catch()` — a typo in a
tuning knob degrades to the safe default, never fails startup. `env.ts`'s
production `superRefine` hard-fails startup only for the genuinely
unsafe combination: `READ_REPLICAS_ENABLED=true` with no configured
replicas.

### `READ_REPLICAS_ENABLED=false` (the default)

Every read and write goes through `DATABASE_URL` alone, exactly as every
existing environment's behavior was before this module existed:
`withReadReplicaRouting()` returns the primary client **completely
untouched** — no extension, no proxy, no per-query branch — mirroring
`withPrismaTracing`'s own disabled-path guarantee. `getReadReplicaHealth()`
resolves immediately to `DISABLED_READ_REPLICA_HEALTH` without pinging
anything. Backward compatibility is total: no existing repository,
migration, or test needs to change.

## 8. Health & monitoring integration

`checks.readReplicas` joins `/api/health/ready`'s established
"operational visibility only" category (alongside `checks.backup`,
`checks.searchEngine`, `checks.analytics`, etc.): reported, never
allowed to change the response's overall `status` or HTTP code. A
replica that is lagging, unreachable, or has never been pinged does not
mean this instance cannot serve traffic — every read that would have
gone there instead falls back to the primary, which `checks.database`
already covers as load-bearing.

- `"disabled"` — `READ_REPLICAS_ENABLED` not `"true"`, or `"true"` with
  no configured replicas. Normal, healthy, the default.
- `"ok"` — every configured replica is `HEALTHY` or `DEGRADED`.
- `"degraded"` — at least one configured replica is `UNHEALTHY` or
  `UNKNOWN`, or the primary itself failed its ping; `issues` names each
  one.

## 9. Composition root and shutdown

`infrastructure/database/replica-router.ts` owns the single process-wide
`ReplicaRouterService`, imported by both `prisma/client.ts` (to build
the routing extension) and `infrastructure/database/compose.ts` (to
feed the active health monitor) — carrying no dependency on
`PrismaClient`, which is what keeps that two-way relationship from
becoming an import cycle (the same role `tracing/compose.ts`'s
`getTracer()` plays for `withPrismaTracing`).

`instrumentation.ts`'s existing SIGTERM/SIGINT shutdown hook calls
`disconnectReadReplicas()` immediately after `prisma.$disconnect()`,
closing every replica connection pool — idempotent, and a safe no-op
when read-replica routing was never enabled.

## 10. Database schema

None. Read-replica routing is a connection/infrastructure-level
concern — it introduces no new table, column, or Prisma model, and
therefore requires no migration. `npx prisma migrate status` is
unaffected by this module.

## 11. Testing

- **Unit** — every domain entity/service (`ReplicaHealth` state
  transitions, each `ReplicaSelector`, `permitsReplicaRead`), the
  application-layer `ReplicaRouterService` (routing, fallback,
  consistency, staleness) and `ReplicaHealthMonitorService` (against a
  fake `ReplicaHealthChecker`), the env-driven `resolveReadReplicaConfig()`,
  `collectReadReplicaHealth()`, `PrismaReplicaHealthChecker` (against a
  mocked replica client), the `read-consistency-context` AsyncLocalStorage
  propagation, and the extension's `routeToReplica()`/`toDelegateName()`/
  `READ_OPERATIONS` routing and fallback behavior (against fakes, the
  same reasoning `parseExporterHeaders` is unit-tested separately from
  `resolveTracingConfig`) — see `tests/unit/core/domain/`,
  `tests/unit/core/application/services/database/`, and
  `tests/unit/core/infrastructure/database/`.
- **Integration** — `tests/integration/database/read-replicas-health-route-wiring.test.ts`
  proves `/api/health/ready` actually surfaces `checks.readReplicas`
  through the real composition root, mirroring Module 54's own
  `backup-health-route-wiring.test.ts`.

Not unit-tested directly: `withReadReplicaRouting()`'s own `client.$extends(...)`
wiring — the same gap Module 51's `withPrismaTracing` also leaves (no
`prisma-tracing.test.ts` exists either), because `$extends` is Prisma's
own tested machinery; this module's own routing/fallback/health logic
inside that hook (`routeToReplica`) is exported and unit-tested
directly instead.

## 12. Limitations and future improvements

- **Raw SQL is never routed.** `$queryRaw`/`$executeRaw` always execute
  on the primary, even for a read-only raw query — a deliberate safety
  boundary (see §3), not an oversight. A future, explicitly-opt-in
  `$queryRawReplica` client-level extension method would be the natural
  way to lift this for callers that want it.
- **No cross-region replica affinity.** `LEAST_LAG` and `ROUND_ROBIN`
  have no concept of a replica's geographic proximity to the serving
  region; a future strategy could weight by region alongside lag.
- **No per-model or per-repository override.** Every model shares one
  module-wide selection strategy and consistency default; a future
  version could let a specific repository request a different strategy
  via the same `AsyncLocalStorage` mechanism `withReadConsistency` uses.
- **Health checks are on-demand, not push-based.** A replica that fails
  between two `/api/health/ready` probes and receives no organic
  traffic in between will not be actively re-checked until the next
  probe — organic traffic's own passive `recordFailure` is what catches
  it in the interim for any replica actually serving reads.
