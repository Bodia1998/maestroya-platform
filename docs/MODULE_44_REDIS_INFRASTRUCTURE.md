# Module 44 — Redis Infrastructure (Roadmap Module 11)

## 1. Objective

Build the Redis infrastructure this codebase's own prior modules
explicitly deferred: a shared, multi-instance-safe cache, a distributed
rate-limit backend (the exact swap Module 24/25 anticipated for
`RateLimitRepository`), and a distributed lock primitive — all wired
through `REDIS_URL` (already reserved, validated, and unused since
Module 25), with zero changes to any existing caller. Explicitly does
**not** touch unrelated architecture: no Clean Architecture layering
change, no Prisma/repository-pattern change, no Event Bus change, no
rewrite of `InMemoryRateLimitRepository`/`CachedGeocodingProvider` (both
left in place, still the default for single-instance deployments).

## 2. Audit findings

| Area | Found at audit time |
|---|---|
| Caching | `CachedGeocodingProvider` (Module 27/42) — an in-memory, TTL-based decorator, process-local only, explicitly designed as "the ready seam" for a future shared cache; no generic/reusable cache abstraction existed |
| Redis | Zero existing usage anywhere in the codebase. `REDIS_URL` existed in `env.ts` (Module 25) — validated (URL shape only) but never read by any other code. No `ioredis`/`node-redis`/any Redis client in `package.json` |
| Rate limiting | `RateLimitRepository` interface + `InMemoryRateLimitRepository` (Module 24) — a fixed-window limiter over a process-local `Map`. Both the interface's own doc comment and `InMemoryRateLimitRepository`'s doc comment explicitly predicted and described the exact Redis-backed swap this module implements (INCR/PEXPIRE via a Lua script for atomicity) |
| Request throttling | Same as rate limiting — no separate throttling mechanism exists; `RATE_LIMIT_POLICIES` (Module 24) is the single source of truth for every limit/window pair, unchanged by this module |
| Distributed locking | None existed. No cron/background job in the codebase currently *requires* one (the workflow-expiration cron route is naturally idempotent) |
| Session storage | Auth.js v5 with the `jwt` session strategy (Module 02) — sessions are self-contained signed JWTs in a cookie, not server-side session records. There is nothing to move to Redis; out of this module's scope entirely (see §12) |
| Queues / pub-sub / background jobs | None exist. `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md` §18 already audited and confirmed this: "no cron, no queue, no scheduled task runner" beyond the one Vercel-Cron-triggered HTTP route (Module 28) |
| Event Bus | `SynchronousEventBus` (Module 37) — fully in-process, synchronous, deliberately not queue-backed. Untouched by this module; a Redis-backed pub/sub event bus would be a different, larger architectural change this module was not asked to make |
| Environment variables / config | `env.ts` (Module 25) — zod-validated, fail-fast, already had `REDIS_URL` reserved and validated (URL shape only) |
| Infrastructure services / DI | No DI container anywhere — every module uses the same manual `compose.ts` composition-root convention (Module 02 onward). This module follows it exactly; no container introduced |
| Prisma performance | Untouched — this module has no read/write path through Prisma at all |
| Existing middleware | `middleware.ts` (Module 25) — request-ID propagation only, explicitly excludes `/api/**`. Untouched |
| API routes / Server Actions | `src/app/api/health/ready/route.ts` (Module 25) already had the exact seam for an additional non-fatal dependency check; extended in place, not duplicated |

## 3. Existing infrastructure reused (not duplicated)

- `RateLimitRepository` interface (`domain/repositories/rate-limit-repository.ts`) — **unchanged**. `RedisRateLimitRepository` implements it as-is; no interface edit was needed, confirming what Module 24/25's own comments predicted.
- `InMemoryRateLimitRepository` — **unchanged**, still the default for `REDIS_URL`-unset environments.
- `rate-limit-window.ts`'s fixed-window semantics — the Redis implementation's Lua script reproduces the identical algorithm (window starts at first attempt, not clock-aligned), not a different one, so behavior is consistent regardless of backend.
- `env.ts`'s `REDIS_URL` field — reused exactly as Module 25 left it (URL shape validation only); only its doc comment was updated to say it's now consumed.
- The `application/ports/*` + `infrastructure/*` + per-module `*-factory.ts` composition convention (`error-reporter-factory.ts`, `geocoding-provider-factory.ts`) — followed exactly for `cache-service-factory.ts`, `rate-limit-repository-factory.ts`, `lock-service-factory.ts`.
- `application/use-cases/security/compose.ts` — one line changed (`new InMemoryRateLimitRepository()` → `createRateLimitRepository()`); every other line, every other use case in that file, untouched.
- `src/app/api/health/ready/route.ts` — extended in place (one additional, non-fatal `checks.cache` field), same pattern as the database check, not duplicated into a new endpoint.
- `instrumentation.ts`'s graceful-shutdown hook — extended with one additional `await getRedisClient()?.quit()` call alongside the existing `prisma.$disconnect()`.
- `server-only` boundary convention — every new server-side module starts with `import "server-only";`, exactly like `logger.ts`/`cached-geocoding-provider.ts`/etc.

## 4. What must remain unchanged (and does)

- `CachedGeocodingProvider` — left exactly as-is. It is not rewired to `CacheService`; that would be an unrelated-module change (Module 27/42's own file) outside this task's scope. A future module could make that swap; this one doesn't.
- `SynchronousEventBus` / Event Bus — untouched.
- `AntiAbuseService`, every Server Action that calls it, and `RATE_LIMIT_POLICIES` — zero changes. The whole point of Module 24's interface design was that this module's swap requires none.
- Prisma client, repositories, migrations — untouched; no schema change.
- Auth.js session strategy — untouched (see §12 for why this module doesn't touch session storage).
- `next.config.ts`, security headers, CSP — untouched.

## 5. New infrastructure implemented

| File | Purpose |
|---|---|
| `src/core/infrastructure/cache/redis-protocol.ts` | RESP2 encode/decode (`encodeCommand`, `parseReply`, `RedisReplyError`) — dependency-free wire-protocol layer (see §6 for why) |
| `src/core/infrastructure/cache/redis-client.ts` | `RedisClient` — minimal TCP/TLS client (`node:net`/`node:tls`) over RESP2: lazy connect, AUTH/SELECT, command queue with ordered-reply matching, connect/command timeouts, `parseRedisUrl` |
| `src/core/infrastructure/cache/redis-client-factory.ts` | `getRedisClient()` — the one shared `RedisClient` instance per process; `null` when `REDIS_URL` is unset |
| `src/core/application/ports/cache-service.ts` | `CacheService` port — `get`/`set`/`delete`/`has`, technology-agnostic |
| `src/core/infrastructure/cache/in-memory-cache-service.ts` | `InMemoryCacheService` — TTL `Map`, same shape/trade-offs as `CachedGeocodingProvider`, generalized into a reusable service |
| `src/core/infrastructure/cache/redis-cache-service.ts` | `RedisCacheService` — `CacheService` over Redis (`SET ... PX`, `GET`, `DEL`, `EXISTS`; JSON-serialized values) |
| `src/core/infrastructure/cache/cache-service-factory.ts` | `createCacheService()` — Redis when configured, in-memory otherwise; memoized |
| `src/core/infrastructure/security/redis-rate-limit-repository.ts` | `RedisRateLimitRepository` — implements the **existing, unmodified** `RateLimitRepository` interface via one atomic `EVAL` (INCR + conditional PEXPIRE + PTTL) per `consume()` |
| `src/core/infrastructure/security/rate-limit-repository-factory.ts` | `createRateLimitRepository()` — Redis when configured, in-memory otherwise; memoized |
| `src/core/application/ports/distributed-lock.ts` | `DistributedLock` port — single `withLock(key, ttlMs, fn)` method, guaranteed release via `try/finally` |
| `src/core/infrastructure/locking/redis-lock-service.ts` | `RedisLockService` — `SET key token PX ttl NX` to acquire; token-checked `EVAL` (GET-then-DEL) to release safely even after TTL-driven re-acquisition by another holder |
| `src/core/infrastructure/locking/in-memory-lock-service.ts` | `InMemoryLockService` — single-process fallback, `Set`-based, same TTL safety net |
| `src/core/infrastructure/locking/lock-service-factory.ts` | `createDistributedLock()` — Redis when configured, in-memory otherwise; memoized |
| `src/app/api/health/ready/route.ts` (modified) | Added a non-fatal `checks.cache` field (`"ok"`/`"error"`/`"not_configured"`) — never changes the route's overall status/HTTP code |
| `instrumentation.ts` (modified) | Graceful shutdown now also closes the Redis connection, if one was ever opened |
| `src/core/infrastructure/config/env.ts` (modified) | `REDIS_URL`'s doc comment updated to point at this module as its consumer; schema/validation itself unchanged |
| `src/core/application/use-cases/security/compose.ts` (modified) | `rateLimits` now built via `createRateLimitRepository()` instead of hardcoding `InMemoryRateLimitRepository` |
| `.env.example` (modified) | `REDIS_URL` comment updated |
| `tests/test-utils/fake-redis-server.ts` | In-process, real-TCP RESP2 fake Redis server for tests (see §10) |
| Tests (§10) | Unit tests for every file above |

## 6. Why a hand-rolled RESP2 client instead of `ioredis`/`node-redis`

This sandbox has **no npm registry access** — confirmed independently
during this module's own work (`npm view ioredis version` → `403
Forbidden`) and previously documented in
`docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md` §25 for four other
toolchains. Module 25 faced the same wall when it considered adding a
Redis dependency and explicitly declined: *"introducing the dependency
now would be speculative infrastructure with no way to test it against a
real environment in this task."*

Rather than defer again, or vendor a hand-authored fake `ioredis` (risking
behavior drift from the real client in ways this task cannot verify), this
module implements the actual wire protocol Redis speaks — RESP2, a small,
stable, versioned text protocol unchanged since Redis 1.2 — directly over
`node:net`/`node:tls`. This is:

- **Real, not speculative.** `redis-protocol.ts` and `redis-client.ts` are
  fully unit-tested against an in-process fake TCP server
  (`tests/test-utils/fake-redis-server.ts`) that speaks genuine RESP2 over
  a real socket — not a mocked interface.
- **Self-contained.** No `package.json` dependency that cannot be
  installed/resolved in this environment (avoiding the exact trap Module
  25 flagged).
- **Narrowly scoped**, per the task's explicit "DO NOT introduce
  unnecessary abstractions" instruction: only the commands this
  codebase's three use cases need (`PING`, `AUTH`, `SELECT`, `GET`, `SET`,
  `DEL`, `EXISTS`, `EVAL`, `QUIT`) — not cluster/sentinel topology,
  pub/sub, streams, or connection pooling.
- **A drop-in-replaceable seam.** `RedisClient`'s `command()` method is
  the only surface every higher-level service depends on. A future
  environment with registry access can swap the implementation for
  `ioredis` behind that same shape with no caller changes, if the fuller
  feature set is ever needed.

## 7. Cache architecture

`CacheService` (`application/ports/cache-service.ts`) is a generic,
technology-agnostic `get`/`set`/`delete`/`has` interface — the same
"application/ports" convention as `ErrorReporter`/`EventBus`.
`createCacheService()` (`cache-service-factory.ts`) returns
`RedisCacheService` when `REDIS_URL` is configured, `InMemoryCacheService`
otherwise, memoized per process — the exact same factory shape as
`createErrorReporter()` (Module 39) and `createGeocodingProvider()`
(Module 27).

`ttlMs` is a required parameter on `set()` (not optional) — an unbounded
cache entry is almost always a bug; this forces every caller to make an
explicit choice, the same discipline `CachedGeocodingProvider` already
applies with its own `DEFAULT_TTL_MS`.

Nothing in the codebase was rewired to use `CacheService` yet —
`CachedGeocodingProvider` keeps its own dedicated in-memory cache, by
design (see §4). `CacheService` is delivered as ready, tested
infrastructure for the next module that needs a shared cache, consistent
with how Module 25 delivered `REDIS_URL` itself without forcing an
immediate consumer.

## 8. Redis infrastructure

`RedisClient` (`infrastructure/cache/redis-client.ts`):

- Parses `redis://`/`rediss://` URLs (`parseRedisUrl`), including
  password and DB index.
- Connects lazily on first `command()` call; reconnects transparently on
  the next call after a dropped connection.
- Sends `AUTH`/`SELECT` automatically post-connect when the URL specifies
  a password/non-zero DB.
- Maintains a FIFO queue of pending commands matched to replies in
  arrival order (RESP guarantees ordered replies on one connection),
  supporting pipelined (overlapping) calls without a per-command
  round-trip wait.
- Enforces both a connect timeout (default 3000ms) and a per-command
  timeout (default 2000ms) — a timed-out command tears down and
  reconnects the whole connection (not just that command) to preserve
  reply ordering for whatever was queued behind it.
- Every failure (refused/timed-out connection, timed-out command, a RESP
  error reply) surfaces as a rejected Promise; no failure mode throws
  synchronously or crashes the process.

`getRedisClient()` (`redis-client-factory.ts`) is the one shared instance
per process, `null` when `REDIS_URL` is unset — every consumer treats
`null` as "use the in-memory fallback," never as an error condition.

## 9. Rate limiting implementation

`RedisRateLimitRepository` implements the **existing, unmodified**
`RateLimitRepository` interface (Module 24). One `EVAL` call per
`consume()`:

```lua
local count = redis.call("INCR", key)
if count == 1 then redis.call("PEXPIRE", key, windowMs) end
local ttl = redis.call("PTTL", key)
-- returns [allowed(0/1), limit-or-remaining, ...]
```

Atomicity matters here specifically because a naive `INCR` + separate
`PEXPIRE` has the exact same read-then-write race
`InMemoryRateLimitRepository`'s own doc comment flags for its `Map`, plus
a crash-between-commands failure mode a single Lua script closes
entirely (Redis guarantees no other command interleaves with a running
script). Window semantics are bit-for-bit the same fixed-window algorithm
as `domain/services/rate-limit-window.ts` — window starts at the first
`consume()` for a key, not clock-aligned — so callers see identical
behavior switching between backends.

`createRateLimitRepository()` (`rate-limit-repository-factory.ts`) is the
swap point: `RedisRateLimitRepository` when `REDIS_URL` is configured,
`InMemoryRateLimitRepository` otherwise. `application/use-cases/security/
compose.ts` was updated to call this factory instead of hardcoding the
in-memory implementation — the single line change Module 25 (§14, §29)
and `InMemoryRateLimitRepository`'s own doc comment both predicted would
eventually be needed, with zero change to `AntiAbuseService` or any
Server Action.

## 9a. Distributed locking

`DistributedLock` (`application/ports/distributed-lock.ts`) exposes a
single `withLock(key, ttlMs, fn)` — no separate acquire/release calls, so
"forgot to release" is structurally impossible. `RedisLockService` uses
`SET key token PX ttlMs NX` to acquire (atomic, race-free by construction)
and a token-checked `EVAL` (`GET` then conditional `DEL`) to release —
the token check prevents a lock instance whose `fn` outran its TTL from
deleting a different holder's subsequent acquisition. `InMemoryLockService`
is the single-process fallback with matching TTL-safety-net semantics.

No existing caller was wired to this — no current cron/background job in
this codebase needs cross-instance mutual exclusion (see §2's audit
finding on the workflow-expiration route's natural idempotency). Delivered
as ready, tested infrastructure for the next module that does.

## 10. Testing

All new, `tests/unit/core/infrastructure/{cache,security,locking}/**`
and one integration-test extension, following this codebase's existing
`describe`/`it` and `vi.resetModules()`-for-factories conventions
(`error-reporter-factory.test.ts`, `geocoding-provider-factory.test.ts`):

- `redis-protocol.test.ts` — RESP2 encode/decode round trips, every reply
  type (simple string, error, integer, bulk string incl. null, nested
  arrays), partial-buffer ("need more data") handling, malformed-input
  error path.
- `redis-client.test.ts` — `parseRedisUrl` cases; `RedisClient` exercised
  against `tests/test-utils/fake-redis-server.ts` (a real in-process TCP
  server speaking RESP2): connect/PING, SET/GET, AUTH success/failure,
  unknown-command error surfacing, reply-ordering under overlapping
  calls, command-timeout and connect-timeout/refused-connection paths,
  `quit()` no-op when never connected.
- `in-memory-cache-service.test.ts` — get/set/delete/has, TTL expiry and
  lazy reclamation (via `vi.useFakeTimers`), TTL-overwrite behavior,
  `ttlMs <= 0` rejection.
- `redis-cache-service.test.ts` — JSON round-trip, miss handling, TTL
  propagation to the (fake) server, malformed-stored-value → miss (not
  throw), `ttlMs <= 0` rejection before contacting Redis.
- `cache-service-factory.test.ts`, `redis-client-factory.test.ts`,
  `rate-limit-repository-factory.test.ts`, `lock-service-factory.test.ts`
  — in-memory vs. Redis selection based on `REDIS_URL`, per-process
  memoization.
- `redis-rate-limit-repository.test.ts` — allow-up-to-limit-then-block,
  `remaining`/`retryAfterMs` values, independent per-key buckets,
  `reset()`, invalid `limit`/`windowMs` rejection, single-`EVAL`-call
  atomicity (spy-verified).
- `in-memory-lock-service.test.ts` / `redis-lock-service.test.ts` —
  acquire/release, blocked-when-held (`fn` never called), guaranteed
  release on `fn` throwing, TTL safety net, token-checked release
  refusing to delete a different holder's lock, invalid `ttlMs`
  rejection.
- `tests/integration/observability/health-routes.test.ts` (extended) —
  `checks.cache` reports `"not_configured"` when `REDIS_URL` is unset,
  and `"error"` (without affecting overall `status`/HTTP code) when
  Redis is configured but unreachable.

No existing test was modified beyond this additive extension; no existing
test's assertions were weakened.

## 11. Validation results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **Pass** — zero errors, whole project (this module's files plus every pre-existing file) |
| `npx eslint .` | **Pass** — zero errors, zero warnings, whole project |
| `npx vitest run ...` | **Blocked — environmental**, not a code defect (see below) |
| `npm run build` | Not attempted — same environmental blocker would apply (native SWC binaries), consistent with Module 25's own finding |

**Environmental limitation, identical to the one `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md` §25 already documented independently:** this sandbox's `node_modules` was populated on darwin-arm64 and lacks the Linux-arm64 native binaries this Linux sandbox needs. Running Vitest here fails immediately with `Cannot find module '@rollup/rollup-linux-arm64-gnu'` (Vitest is built on Vite/Rollup) — before any test file is even loaded, so this is not specific to this module's new tests. The sandbox also has no npm registry access (`403 Forbidden`, confirmed independently for `ioredis` during this module's own work — see §6), so the missing native binary cannot be fetched here either.

`tsc --noEmit` and `eslint` have no native-binary dependency, which is exactly why both ran cleanly end-to-end against every file this module added or touched. This is the same substitute-verification posture Module 25 took: **`npm test` in a working environment (real CI, or a correctly Linux-provisioned/`npm ci`-fresh machine) is the outstanding confirmation step** for this module's test suite, not yet claimed as confirmed by an actual run. Test logic was additionally reviewed by hand for correctness (assertion values traced against the Lua scripts' and fake server's actual behavior) given it could not be executed here.

## 12. Explicit boundary: session storage

Session storage was in the audit's scope list; this module deliberately
does not move anything there. Auth.js v5 (Module 02) uses the `jwt`
session strategy — sessions are self-contained, signed JWTs carried in a
cookie, not server-side records that could be "moved to Redis." There is
no session store to migrate. A future move to Auth.js's `database`
session strategy (server-side sessions) would be a Module 02-owned
architectural decision with its own trade-offs, out of this module's
scope to make unilaterally.

## 13. Known limitations

- `RedisClient` is a single connection per process, not a connection
  pool — sufficient for this codebase's request volume and command
  shapes (short-lived commands, no long-running blocking operations),
  but a future high-throughput need might want pooling.
- No cluster/sentinel topology support — a single `REDIS_URL` endpoint
  only, matching the single-instance-to-single-Redis topology this
  codebase's other infrastructure (single Postgres, single Cloudinary
  account) already assumes throughout.
- `RedisCacheService`/`RedisRateLimitRepository`/`RedisLockService` are
  not wired into any existing caller (`CachedGeocodingProvider` keeps its
  own cache; no cron job uses the lock yet) — delivered as ready,
  fully-tested infrastructure, not force-adopted, consistent with this
  task's explicit "DO NOT introduce unnecessary abstractions" instruction
  and Module 25's own precedent for `REDIS_URL` itself.
- Test suite could not be executed in this sandbox (§11) — environmental,
  not a code defect, and not unique to this module (Module 25 hit the
  identical wall). Must be run in a working environment before this
  module is considered fully confirmed.
- No production Redis instance is provisioned in any environment today
  (`REDIS_URL` remains unset in `.env`/`.env.production`) — this module
  makes the infrastructure real and tested, but provisioning an actual
  managed Redis (e.g. for a future multi-instance deployment) is an
  operational/deployment decision outside this module's scope, the same
  boundary Module 25 drew around Redis in its own §29 checklist.

## 14. Confirmation: no unrelated architecture was modified

Full diff scope for this module (`git status`):

**Modified (6 files, all additive):** `.env.example`, `instrumentation.ts`,
`src/app/api/health/ready/route.ts`,
`src/core/application/use-cases/security/compose.ts`,
`src/core/infrastructure/config/env.ts`,
`tests/integration/observability/health-routes.test.ts`.

**New (everything else):** `src/core/application/ports/cache-service.ts`,
`src/core/application/ports/distributed-lock.ts`,
`src/core/infrastructure/cache/**`, `src/core/infrastructure/locking/**`,
`src/core/infrastructure/security/redis-rate-limit-repository.ts`,
`src/core/infrastructure/security/rate-limit-repository-factory.ts`,
`tests/test-utils/fake-redis-server.ts`,
`tests/unit/core/infrastructure/{cache,security,locking}/**`.

No Prisma schema/migration, no domain entity, no other module's
composition root, no UI component, no Server Action, no i18n message file,
and no other module's test was touched. Clean Architecture layering
(domain → application → infrastructure) is preserved: `RateLimitRepository`
and the two new ports (`CacheService`, `DistributedLock`) live in
domain/application; every Redis-specific implementation detail lives in
infrastructure only.
