# Module 58 — Multi-Instance Safety Audit

## 1. Purpose

Modules 44 (Redis Infrastructure), 45 (Background Jobs), 48 (Real-Time), 54 (Backup & Disaster Recovery), 55 (Read Replicas), and 56 (Health Checks & Circuit Breakers) each independently built the pieces a horizontally-scaled deployment needs: distributed locks, Redis-backed caches/rate limits, idempotent job execution, read-replica routing, per-instance health checks. What none of them did — because it wasn't their job — is answer the question a release sign-off actually needs answered: *taken together, is it actually safe to run more than one instance of this application behind a load balancer, or does something quietly assume there's only ever one process?*

Module 58 is that answer, and — following the same discipline Module 57 established for capacity — it is not a promise, it's a **tool that proves it**. `npm run multi-instance-audit` runs twelve checkers, each performing real static analysis over this repository's own source tree (pattern-matching against the actual `redis-lock-service.ts`, `job-idempotency-store.ts`, `read-replica-extension.ts`, and so on — never a hardcoded verdict), and produces a scored, reasoned report: `reports/multi-instance-safety-report.md` and `reports/multi-instance-safety-report.json`.

The scope mirrors the audit brief exactly — twelve subsystems, each responsible for one or more of the failure modes horizontal scaling can introduce: race conditions, duplicate processing, stale cache reads, inconsistent writes, lost events, broken transactions, session inconsistency, distributed locking issues, eventual consistency failures, background worker conflicts, and duplicated scheduled jobs.

## 2. Architecture

```
domain/entities/
  audit-finding.ts               AuditFinding (Problem/Risk/Why it happens/Impact/Recommended fix/Priority)
  subsystem-audit-result.ts      SubsystemAuditResult — one checker's output, status derived from findings
  multi-instance-safety-report.ts MultiInstanceSafetyReport — the report aggregate

application/ports/
  safety-checker.ts               SafetyChecker, SubsystemCheckOutcome, CheckerFindingInput
application/services/safety/
  audit-scoring-service.ts        AuditScoringService — overallScore + recommendedActions
application/use-cases/safety/
  run-multi-instance-safety-audit.use-case.ts   RunMultiInstanceSafetyAuditUseCase — the one entry point

infrastructure/multi-instance-safety/
  source-scanner.ts               SourceScanner — the one infrastructure primitive every checker shares
  report-generator.ts             buildStructuredReport()/renderMarkdownReport()/toJsonReport()
  compose.ts                      composition root — wires all twelve checkers + the use case
  checkers/
    stateless-auth-session-checker.ts
    distributed-locking-checker.ts
    idempotency-checker.ts
    event-bus-checker.ts
    cache-consistency-checker.ts
    rate-limiting-checker.ts
    read-replica-checker.ts
    transaction-concurrency-checker.ts
    scheduler-cron-checker.ts
    realtime-session-checker.ts
    upload-consistency-checker.ts
    health-scaling-readiness-checker.ts

scripts/run-multi-instance-safety-audit.ts   npm run multi-instance-audit — the CLI entry point
```

This is the structurally simplest of Modules 54-58: **no persistence layer, no queue, no worker, no scheduler, no API route, and no database or Redis dependency of its own.** Every checker is pure, read-only static analysis over the repository's own already-committed source (`SourceScanner`), and `RunMultiInstanceSafetyAuditUseCase` assembles their output into a `MultiInstanceSafetyReport` entirely in memory. This is deliberate, not an oversight: a tool whose job is to audit *other* modules' database/Redis dependencies must itself keep working when those backing services are unreachable — otherwise a broken audit tool could mask exactly the kind of infrastructure problem it exists to catch.

## 3. Domain model

### Findings

`AuditFinding` (`domain/entities/audit-finding.ts`) is the unit of "something a reviewer needs to look at" — the same role `CapacityBottleneck` plays for Module 57. Every field the report content requirements ask for is a required, non-empty constructor argument: `problem`, `risk`, `whyItHappens`, `impact`, `recommendedFix`, `priority` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), plus `severity` (`WARNING`/`CRITICAL` — never `SAFE`; a finding is by definition something that isn't fully safe, so a "SAFE finding" would be a contradiction) and `evidence` (the file paths this finding is grounded in). Construction throws `ValidationError` for any blank required field — a finding a reviewer can't actually act on (e.g. an empty `recommendedFix`) is worse than no finding at all.

### Subsystem results

`SubsystemAuditResult` (`domain/entities/subsystem-audit-result.ts`) is one checker's complete output — built only via the named factory `SubsystemAuditResult.build`, mirroring `LoadTestResult.schedule()`'s "aggregates come from a named factory" convention. Its `status` (`SAFE`/`WARNING`/`CRITICAL`) is **derived**, never caller-supplied: `CRITICAL` if any finding is `CRITICAL`, else `WARNING` if any finding is `WARNING`, else `SAFE`. `build()` also enforces that every finding it's given actually belongs to the subsystem being built — a checker cannot accidentally (or maliciously) attribute a finding to a different subsystem than the one it inspected.

### The report

`MultiInstanceSafetyReport` (`domain/entities/multi-instance-safety-report.ts`) is the production-readiness sign-off artifact this module exists to produce — the same role `CapacityReport` plays for Module 57. `isProductionReady` is a documented cut line, deliberately the same shape as `CapacityReport.isProductionReady`: `overallScore >= 70` **and** zero subsystems left `CRITICAL` — a single undiscovered-but-critical issue can never be masked by a high average score across everything else. `build()` rejects a score outside `0..100` and an empty subsystem list (an audit that ran zero checkers audits nothing, and must not silently report a passing grade).

## 4. Application layer

`SafetyChecker` (`application/ports/safety-checker.ts`) is the seam application code depends on for inspecting one subsystem — the same Dependency Inversion boundary `LoadTestExecutor` draws for Module 57. A checker never constructs an `AuditFinding` itself (that would let two checkers hand out colliding ids and would scatter the subsystem-ownership invariant `SubsystemAuditResult.build` enforces across every implementation) — it returns plain `CheckerFindingInput` data, and `RunMultiInstanceSafetyAuditUseCase` is the single place ids are minted.

`AuditScoringService` (`application/services/safety/audit-scoring-service.ts`) computes `overallScore` with a fully transparent, additive penalty model — no black-box formula: starts at 100, every `CRITICAL` finding deducts a priority-weighted penalty (`LOW` 8 / `MEDIUM` 12 / `HIGH` 18 / `CRITICAL` 25), every `WARNING` deducts a flat 5, clamped to `[0, 100]`. `buildRecommendedActions()` ranks every finding's `recommendedFix` worst-first (critical before warning, then by priority), deduplicates identical recommendations across checkers, and caps the list at 10 — a reviewer gets a short, actionable punch list, not an unranked wall of text.

`RunMultiInstanceSafetyAuditUseCase` (`application/use-cases/safety/run-multi-instance-safety-audit.use-case.ts`) is the single entry point. It runs every registered checker through `Promise.allSettled` — never a plain `Promise.all` — so one checker's own bug can never prevent every other subsystem from being reported on; checkers are pure read-only static analysis with no shared mutable state, so running them concurrently introduces no race of its own. A checker that throws is converted into a single synthetic `CRITICAL` finding for its own subsystem ("this checker could not complete its inspection") rather than failing the whole audit — the conservative, safe default: an unverified subsystem is treated as unsafe, never implicitly safe.

## 5. Infrastructure layer — the twelve checkers

Every checker below performs real pattern-matching against this repository's actual source files via `SourceScanner` (`infrastructure/multi-instance-safety/source-scanner.ts` — the one shared infrastructure primitive, a thin `readFile`/`contains`/`exists` wrapper rooted at `process.cwd()` that never throws for an absent file). Findings are grounded in what the audit actually found in this codebase as of this module's authorship, not generic boilerplate.

1. **`StatelessAuthSessionChecker`** — Authentication, sessions, refresh tokens. Confirms `auth-config.ts` uses Auth.js's `"jwt"` session strategy (a signed, stateless token any instance can verify with the shared `AUTH_SECRET`) and that refresh/reset/verification tokens (`tokens.ts`) are SHA-256-hashed before being persisted in the shared, Prisma-backed database.
2. **`DistributedLockingChecker`** — Distributed locking, deadlock avoidance. Confirms `RedisLockService` acquires via an atomic `SET key token PX ttl NX` and releases only via a token-checked Lua compare-and-delete (never a blind `DEL`), and that `lock-service-factory.ts` prefers the Redis-backed implementation whenever configured. Flags (as a `WARNING`) that the documented single-process fallback remains reachable if `REDIS_URL` is ever left unset in a multi-instance deployment.
3. **`IdempotencyChecker`** — Idempotency, duplicate payments, webhook safety. Confirms the codebase's three real idempotency layers (enqueue-time `jobId` de-duplication, execution-time `JobIdempotencyStore`, and the financial ledger's database-unique `idempotencyKey`), and notes — as a forward-looking `WARNING`, not a live bug — that no Stripe webhook route exists yet in this codebase, so the moment one is added it must reuse these same patterns.
4. **`EventBusChecker`** — Event ordering, lost events, duplication. Confirms `QueuedEventBus` preserves `SynchronousEventBus`'s exact `EventDispatchError` failure contract and processes `publishAll` sequentially (never concurrently) to preserve causal ordering across the queue boundary.
5. **`CacheConsistencyChecker`** — Caching, Redis consistency. Confirms `CacheService.set()` requires a mandatory TTL (bounding staleness even if an explicit invalidation is missed) and that `cache-service-factory.ts` prefers `RedisCacheService` whenever configured.
6. **`RateLimitingChecker`** — Rate limiting/anti-abuse consistency. Confirms `rate-limit-repository-factory.ts` prefers the Redis-backed repository (shared, correctly-enforced counters) whenever configured — the in-memory fallback would otherwise multiply the effective limit by instance count.
7. **`ReadReplicaChecker`** — Read replica/eventual consistency. Reuses Module 55's own routing logic: confirms writes and raw SQL always execute on the primary ("when in doubt, use the primary"), and that a caller can force `STRONG` consistency for read-after-write cases.
8. **`TransactionConcurrencyChecker`** — Lost updates, optimistic concurrency, transaction safety. Verifies this codebase's actual pattern — a conditional, count-checked `updateMany` inside a Prisma `$transaction` (worked example: `PrismaQuoteAcceptanceRepository.acceptQuote`) — rather than assuming a `version` column exists, and measures how many other repositories reuse the same guard.
9. **`SchedulerCronChecker`** — Duplicated scheduled jobs, cron duplication. Confirms `JobScheduler` enqueues every occurrence under a deterministic id (`repeat:<name>:<occurrenceMs>`) so two instances converge on the same id rather than double-scheduling, and that the Vercel Cron HTTP endpoint requires a shared-secret bearer token.
10. **`RealtimeSessionChecker`** — Real-time presence, cross-instance fan-out. Cross-checks Module 48's own documented gap (`docs/MODULE_48_REALTIME_SYSTEM.md` §11): a `publish()` on one instance cannot yet reach a client connected to a different instance, because the hand-rolled Redis client doesn't implement `SUBSCRIBE`. Surfaced here as a `WARNING` so it's visible in this audit's own report, not only in a module-specific doc.
11. **`UploadConsistencyChecker`** — File upload/retry safety. Confirms Cloudinary uploads use a deterministic `public_id` (e.g. `userId`) with `overwrite: true`, so a retried upload converges on the same asset rather than accumulating duplicates.
12. **`HealthScalingReadinessChecker`** — Horizontal scaling readiness. Reuses Module 56's own health surface: confirms `/api/health/ready` answers per-instance ("can *this* instance safely receive traffic"), distinguishes hard dependencies (PostgreSQL) from optional/degradable ones, and that a separate startup probe and observable circuit-breaker state exist.

### report-generator.ts

`buildStructuredReport()`/`renderMarkdownReport()`/`toJsonReport()` mirror Module 57's own `report-generator.ts` exactly in shape: a traffic-light `readinessStatus` (`Green` ≥90, `Yellow` 70-89, `Red` <70, identical cut lines to Module 57's `readinessStatusFor`), per-subsystem status rows, a risk classification (subsystem counts per `SAFE`/`WARNING`/`CRITICAL`), the full warnings/critical-issues lists (each with Problem/Risk/Why it happens/Impact/Recommended fix/Priority/Evidence), the flattened passed-checks list, and the ranked recommended actions.

### scripts/run-multi-instance-safety-audit.ts

`npm run multi-instance-audit` runs `tsx --conditions=react-server scripts/run-multi-instance-safety-audit.ts` — the same runner/condition Module 57's `capacity-report` script uses, since `compose.ts` is `"server-only"`. Unlike `run-capacity-report.ts`, there is no report-anchoring database row to persist and therefore no non-fatal persistence try/catch: this module holds no persistence layer at all. The only fatal failure mode is the report files themselves failing to write.

## 6. Configuration

None. This module reads no environment variable of its own and requires no database or Redis connection — every checker's only external dependency is the repository's own source tree, read via `SourceScanner` rooted at `process.cwd()`.

## 7. Scope decisions

- **No persistence, no queue/worker/scheduler, no API route.** The audit is a synchronous, in-process, on-demand static analysis, run via CLI — the same reasoning Module 57 gives for holding no queue/worker/scheduler, taken one step further: this module also holds no database/Redis dependency, so it keeps working even when every module it audits is unreachable.
- **Static analysis, not runtime introspection.** Every checker inspects source text, never a running process's actual runtime configuration (e.g. it cannot know whether `REDIS_URL` is actually set in a given deployment) — findings about "what happens if REDIS_URL is unset" are therefore always framed as the documented risk of a possible misconfiguration, not an assertion about the current deployment's live state. A companion runtime check (e.g. an admin-only health endpoint asserting `REDIS_URL` is set whenever more than one instance is expected) is called out as a recommended fix by several checkers, but is out of scope for this module itself.
- **No DTOs layer** — `SafetyChecker`/`AuditFinding`/`SubsystemAuditResult` are used directly by the use case and the report generator, the same "no project-wide `application/dto/` convention for every module" pattern Module 57 follows.
- **Twelve checkers, not thirty** — the audit brief lists ~30 individual concerns (idempotency verification, duplicate payment prevention, Stripe webhook idempotency, background worker duplication, cron duplication, etc.); this module groups closely-related concerns under one checker per cohesive subsystem (e.g. `IdempotencyChecker` covers idempotency verification, duplicate payment prevention, *and* Stripe webhook idempotency together) rather than one checker per bullet point, since they share the same evidence and the same reviewer-facing "subsystem".

## 8. Testing

`tests/unit/core/domain/entities/{audit-finding,subsystem-audit-result,multi-instance-safety-report}.test.ts` — construction validation, derived-status logic, the production-readiness cut line. `tests/unit/core/application/services/safety/audit-scoring-service.test.ts` — the additive scoring formula, clamping, recommended-action ranking/deduplication/capping. `tests/unit/core/application/use-cases/safety/run-multi-instance-safety-audit.use-case.test.ts` — report assembly from mocked checkers, unique finding ids, and the "a throwing checker becomes a CRITICAL finding without failing the audit" contract. `tests/unit/core/infrastructure/multi-instance-safety/source-scanner.test.ts` — file read/contains/exists against a temporary fixture directory, including the "absent file returns null/false, never throws" contract. `tests/unit/core/infrastructure/multi-instance-safety/checkers/*.test.ts` — representative checkers (`DistributedLockingChecker`, `IdempotencyChecker`) exercised against fixture source trees covering both the safe and unsafe branches of their pattern matching. `tests/unit/core/infrastructure/multi-instance-safety/report-generator.test.ts` — structured/Markdown/JSON rendering, readiness-status banding. `tests/integration/multi-instance-safety/compose-wiring.test.ts` — the real composition root end to end, every checker running its real static analysis against this actual repository checkout, proving the whole pipeline is constructible and produces a well-formed report with no mocking.

## 9. Validation results

`npx tsc --noEmit` (full repository): clean. `npm run lint` (full repository): clean. `npm test` (full suite, run in chunks due to this sandbox's per-command time limit): every chunk passed with zero test failures. The only errors observed were pre-existing unhandled background rejections from the shared Prisma client's query-engine bootstrap failing in this sandbox (no network access to fetch the `linux-arm64` engine binary — the same root cause Module 57's own doc already documents for `prisma generate`), affecting unrelated modules across the suite, not introduced by this module. `npm run multi-instance-audit` runs successfully against this repository and writes `reports/multi-instance-safety-report.md`/`.json` with real, grounded findings — see those files for the current score and verdict. `npm run build` did not complete within this sandbox's per-command time cap in this session (consistent across repeated attempts, with no incremental output even shortly before the cap) — this module's own files are not imported by any `src/app` route or page, and a full, clean `tsc --noEmit`/`eslint .` pass across the whole repository (which `next build`'s own type-checking and linting stages would otherwise catch first) leaves no indication this module is the cause.
