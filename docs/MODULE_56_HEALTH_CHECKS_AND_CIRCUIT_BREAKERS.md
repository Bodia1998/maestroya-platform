# Module 56 — Health Checks & Circuit Breakers

## 1. Purpose

Modules 44-55 each added their own `*-health.ts` collector and wired it into `/api/health/ready`. That gave the platform per-dependency visibility, but three things were still missing:

1. **A reusable framework.** Every collector was a bespoke function; there was no shared abstraction for "an independent component that can report `HEALTHY`/`DEGRADED`/`UNHEALTHY`."
2. **Failure isolation with teeth.** Nothing stopped a hung dependency's health check itself from hanging the whole readiness probe, and nothing stopped an application call from retrying a dependency that had already demonstrated it is down.
3. **A few dependencies with no health check at all** — Stripe, Cloudinary, Resend, Twilio (outside its queue), and the OpenTelemetry collector's own configuration.

Module 56 adds a generic health-check framework and a generic circuit breaker engine, wires every existing dependency check through both, and fills the three gaps above — without changing a single existing route's contract or a single existing module's business logic.

## 2. Architecture

Strict Clean Architecture, the same four layers every other module in this codebase uses:

```
src/core/domain/
  entities/health-status.ts        HealthStatus, HealthCheckResult, PlatformHealthReport, aggregateHealthStatus
  entities/circuit-breaker.ts      CircuitState, CircuitBreakerConfig, CircuitBreakerMetrics, CircuitBreakerSnapshot
  errors/circuit-breaker-open-error.ts
  errors/circuit-breaker-timeout-error.ts
  services/circuit-breaker.ts      CircuitBreaker — the pure state machine

src/core/application/
  ports/health-contributor.ts               HealthContributor, HealthCheckOutcome
  services/health/health-check-registry.ts  HealthCheckRegistry — aggregates contributors
  services/health/circuit-breaker-registry.ts  CircuitBreakerRegistry — owns named breakers
  services/health/dependency-status.ts      DependencyStatus + toDependencyStatus projection
  use-cases/health/get-platform-health.use-case.ts
  use-cases/health/get-circuit-breaker-status.use-case.ts
  use-cases/health/reset-circuit-breaker.use-case.ts

src/core/infrastructure/
  config/env.ts                              Module 56 section (new env vars only — additive)
  health/health-status-normalizer.ts         maps every existing status vocabulary to HealthStatus
  health/circuit-breaker-health-contributor.ts  adapts an existing collector into a HealthContributor
  health/external-dependency-checks.ts       Stripe/Cloudinary/Resend/Twilio/OpenTelemetry checks
  health/circuit-breaker-executor.ts         withCircuitBreaker() — extension point for real calls
  health/compose.ts                          composition root — the only place that wires it all up

src/app/api/health/
  route.ts               unchanged — Module 25 liveness
  ready/route.ts          unchanged — Module 25/44-55 readiness
  startup/route.ts        new — startup probe
  diagnostics/route.ts    new — full platform health report
  circuit-breakers/route.ts  new — circuit breaker + dependency status, GET/POST reset
```

The domain layer has zero dependency on any framework, HTTP client, or database driver — `CircuitBreaker` wraps an arbitrary `() => Promise<T>` and knows nothing about what it protects. The application layer knows the `HealthContributor` port but never a concrete implementation. `infrastructure/health/compose.ts` is the single composition root that connects concrete dependencies (Prisma, the existing Modules 44-55 `compose.ts` health functions, the new external-dependency checks) to the framework — the same manual, no-DI-container convention every other `compose.ts` in this codebase already follows.

## 3. Design decisions

**No existing business logic changed.** Every `*-health.ts`/`get*Health()` collector from Modules 44-55 is imported and wrapped, never rewritten. `/api/health` and `/api/health/ready` are untouched — same routes, same contract, same HTTP status semantics, same fields. Module 56 is purely additive.

**Status normalization, not a rewrite.** Each existing module has its own narrow status vocabulary (`"ok"|"error"`, `"healthy"|"degraded"|"unavailable"`, `"ok"|"degraded"|"disabled"`, ...). `health-status-normalizer.ts` is the single place that folds all of them into the framework's three-state `HealthStatus`, following the precedent every one of those modules already established: `"disabled"`/`"not_configured"`/`"bypassed"` is a healthy, deliberate state, never a failure.

**One circuit breaker per dependency, not a shared one.** `CircuitBreakerRegistry.getOrCreate` names breakers by dependency (`postgres-primary`, `redis`, `stripe`, ...). There is no shared state between breakers — a hung or failing dependency can never affect another's state or metrics. This is what makes "Failure Isolation" (Requirement 4) real: each health check executes through its own breaker with its own timeout, and `HealthCheckRegistry.runAll` already runs every contributor concurrently on top of that.

**Dependency monitoring is a projection, not a second bookkeeping path.** Requirement 3 asks for availability/latency/last-success/last-failure/error-count per dependency. Every one of those fields is already recorded by `CircuitBreaker.getSnapshot()` as a side effect of the breaker protecting that dependency's calls. `toDependencyStatus()` (`application/services/health/dependency-status.ts`) is a pure, one-way projection — never a duplicate counter.

**External checks report configuration, not a live call, by default.** Stripe/Cloudinary/Resend/Twilio/OpenTelemetry checks in `external-dependency-checks.ts` report credential/configuration presence rather than making a real network call on every health-check poll. This mirrors the existing `GEOCODING_PROVIDER`/`SEARCH_PROVIDER` principle in `env.ts`: no outbound call should happen as a side effect of something polled far more often than a real request, unless deliberately configured to. Each check still runs through its own dedicated circuit breaker, which is exactly the extension point a future real ping needs (see §6).

**Health checks and real traffic share one breaker per dependency.** `withCircuitBreaker()` (`circuit-breaker-executor.ts`) uses the exact same named breaker `compose.ts` registers for that dependency's health contributor. A future call site that wraps a real Stripe/Cloudinary/Resend call in `withCircuitBreaker("stripe", ...)` and the `stripe` health check will always report the same state — there is never a second, diverging view of one dependency's health.

## 4. Health check lifecycle

1. A `HealthContributor` is registered with `HealthCheckRegistry` (once, in `compose.ts`, at first access — lazy, like every other singleton in this codebase).
2. A caller (a route handler, a use-case) calls `registry.runAll()`.
3. The registry runs every registered contributor's `check()` concurrently (`Promise.all`).
4. Each contributor's `check()`:
   - Resolves its dedicated `CircuitBreaker` from the shared `CircuitBreakerRegistry`.
   - Executes the wrapped collector through `breaker.execute(...)`.
   - Normalizes the collector's raw status string to `HealthStatus`.
   - Never throws — any error (including a breaker rejection) is caught and reported as `UNHEALTHY` with the error message attached.
5. The registry stamps each result with `component`, `responseTimeMs`, and `timestamp` uniformly (contributors never do this themselves — see `HealthCheckRegistry.runOne`'s own doc comment for why).
6. `aggregateHealthStatus` folds every result into one platform-wide `status` via worst-status-wins (`UNHEALTHY` > `DEGRADED` > `HEALTHY`).

## 5. Circuit breaker flow

```
                 failureThreshold consecutive failures
        ┌─────────────────────────────────────────────┐
        │                                               ▼
   ┌─────────┐                                     ┌─────────┐
   │ CLOSED  │◄────────────────────────────────────│  OPEN   │
   └─────────┘   successThreshold consecutive       └─────────┘
        ▲         successes in HALF_OPEN                 │
        │                                                 │ resetTimeoutMs elapsed
        │              single failure in HALF_OPEN        │ → one trial call allowed
        │         ┌───────────────────────────────────────┘
        │         ▼
        │   ┌───────────┐
        └───│ HALF_OPEN │
            └───────────┘
```

- **CLOSED** — calls pass through. Consecutive failures are counted; a success resets the counter (only *consecutive* failures trip the breaker). `failureThreshold` consecutive failures → `OPEN`.
- **OPEN** — every call is rejected immediately with `CircuitBreakerOpenError`, without ever invoking the wrapped function — the entire point of a circuit breaker. After `resetTimeoutMs`, the next call is let through as a single trial and the breaker moves to `HALF_OPEN`.
- **HALF_OPEN** — trial calls are allowed through. `successThreshold` consecutive successes → `CLOSED` (a completed automatic recovery, counted in `recoveryCount`). A single failure → `OPEN` immediately, without needing another full `failureThreshold` count — a still-broken dependency should not get a second full grace period.
- **Timeout** — a call that does not settle within `timeoutMs` is treated as a failure (recorded separately as `timeoutCount`, distinct from `failureCount`, since "never answered" and "answered with an error" are different failure modes worth telling apart).
- **Manual reset** — `CircuitBreaker.reset()` forces `CLOSED` from any state, for an operator who has confirmed a dependency has recovered and doesn't want to wait out `resetTimeoutMs`. Exposed via `POST /api/health/circuit-breakers`.

## 6. Extension guide

**Adding a health check for a new dependency.**

1. If the dependency already has a `collect*Health()`/`get*Health()` function somewhere in `infrastructure/`, wrap it:
   ```ts
   createCircuitBreakerHealthContributor({
     name: "my-new-dependency",
     registry,
     collect: getMyNewDependencyHealth,
   })
   ```
2. If it doesn't, write a small collector returning `{ status: string, ...details }` (see `external-dependency-checks.ts` for the pattern) and wrap it the same way.
3. Register it in `buildContributors()` in `infrastructure/health/compose.ts`. That's the only file that needs to change — the domain and application layers never need to know a new dependency exists.

**Protecting a real call, not just its health check.** Use `withCircuitBreaker(name, fn)` from `infrastructure/health/circuit-breaker-executor.ts` at the actual call site, using the same `name` the corresponding health contributor uses. No other file needs to change.

**Tuning one dependency differently from the rest.** Pass a `config` (any subset of `CircuitBreakerConfig`) to `createCircuitBreakerHealthContributor`/`getOrCreate`/`withCircuitBreaker` — it's merged over the registry's process-wide defaults (`env.CIRCUIT_BREAKER_*`), which are themselves only a starting point, not a hard-coded value.

## 7. Configuration (`env.ts`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `HEALTH_CHECKS_ENABLED` | `true` | Master switch. `false` makes `/api/health/diagnostics` and `/api/health/circuit-breakers` report `disabled` without running any check. Never affects `/api/health` or `/api/health/ready`. |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5` | Consecutive failures, from `CLOSED`, before a breaker opens. |
| `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` | `2` | Consecutive successes, from `HALF_OPEN`, before a breaker closes. |
| `CIRCUIT_BREAKER_TIMEOUT_MS` | `5000` | Per-execution timeout before a call is treated as a (timeout) failure. |
| `CIRCUIT_BREAKER_RESET_TIMEOUT_MS` | `30000` | How long a breaker stays `OPEN` before a `HALF_OPEN` trial call is allowed. |

All four tuning knobs use `.catch()`, not `.default()` — an operational typo degrades to the safe default rather than failing application startup, the same rule every other tuning knob in `env.ts` follows.

## 8. Health endpoints

| Endpoint | Purpose | Status codes |
| --- | --- | --- |
| `GET /api/health` | Liveness (Module 25, unchanged) | 200 always |
| `GET /api/health/ready` | Readiness (Modules 25/44-55, unchanged) | 200 / 503 on database failure |
| `GET /api/health/startup` | Startup probe — has this instance finished initializing | 200 (`started`) / 503 (`starting`) |
| `GET /api/health/diagnostics` | Full platform health report: overall status, every subsystem, every dependency, every circuit breaker | 200 always (visibility only — `status` field in the body conveys health) |
| `GET /api/health/circuit-breakers` | Every circuit breaker's snapshot + dependency status | 200 always |
| `POST /api/health/circuit-breakers` | Manual reset — body `{ "name": "<breaker>" }` or `{ "name": "all" }` | 200 on success, 404 if the named breaker isn't registered, 400 on a malformed body |

## 9. Production recommendations

- **Tune `CIRCUIT_BREAKER_TIMEOUT_MS` per dependency where the defaults don't fit.** A fast in-region cache and a third-party payment API do not have the same acceptable latency; pass an explicit `config` at the `compose.ts` registration site for outliers rather than changing the global default.
- **Restrict `POST /api/health/circuit-breakers` at the infrastructure layer** (reverse proxy / IP allowlist) in a production deployment — it is intentionally unauthenticated at the application layer, consistent with every other route under `/api/health/**` in this codebase, but a manual reset is an operational action worth gating externally.
- **Wire `withCircuitBreaker()` into real external calls incrementally**, starting with the highest-traffic or most failure-prone integration (Stripe is the natural first candidate, given "future-ready" in the requirements) — each addition is a one-line change at the call site with zero framework changes required.
- **Point a dashboard or alerting rule at `/api/health/diagnostics`**, not `/api/health/ready` — the latter deliberately never reflects a degraded external dependency (by Module 25/44-55 design), while diagnostics reports every subsystem's true state for operational visibility.
- **Treat `OPEN` circuit breakers as an alerting signal**, not just `UNHEALTHY` health checks — a breaker that has been `OPEN` for an extended period, visible via `openedAt` in `/api/health/circuit-breakers`, indicates a dependency that has not self-recovered within `resetTimeoutMs` and may need manual intervention.
