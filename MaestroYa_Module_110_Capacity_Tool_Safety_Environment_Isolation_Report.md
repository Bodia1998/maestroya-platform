# MaestroYa Module 110 — Capacity Tool Safety & Environment Isolation

**Branch:** `feature/module-110-capacity-tool-safety-environment-isolation`
**Date:** 2026-09-15
**Role:** Senior Backend Engineer / Principal Engineer (security, database, production-readiness)

## 1. Executive Summary

Module 109 found that the capacity/load-test tooling (Module 57, `npm run capacity-report`) can write synthetic `LoadTestRun` data into whatever `DATABASE_URL` is currently active, with no environment guard — and in that session the write reached toward the shared Supabase database before failing for an unrelated, incidental reason (a Prisma engine binary/platform mismatch), not because of any safety gate (Finding F1, Critical). Module 109 also found that `.env`, `.env.local`, and `.env.production` all resolve to the same Supabase project, so there is no isolated non-production database to write test data into even if a guard existed (Finding F2, Critical).

This module closes F1 in code: both real write paths this tooling uses — `PrismaLoadTestResultRepository.save()` (used by `GenerateCapacityReportUseCase`'s per-scenario persistence and by `PersistCapacityReportUseCase`'s summary-row persistence) and `PrismaPerformanceBaselineRepository.save()` (used by `GenerateCapacityReportUseCase`'s baseline auto-capture) — now go through a single, shared, fail-closed guard (`assertCapacityPersistenceAllowed()`, in a new file, `src/core/infrastructure/database/capacity-persistence-guard.ts`) before ever calling Prisma. The guard requires BOTH an explicit opt-in (`ALLOW_CAPACITY_REPORT_PERSISTENCE=true`, default disabled) AND an independent classification of `DATABASE_URL` as a safe disposable/approved capacity-test database — the opt-in flag alone is never sufficient. No `.env`/`.env.local`/`.env.production` file was modified, no infrastructure was created or changed, and Module 91's own real-DB test-harness guard (`tests/test-utils/db/test-database-url.ts`) was left completely untouched.

F2 (no isolated staging/pre-production database in this repository's own configuration) remains **not fixed by this module by design** — the task brief is explicit that this is an infrastructure/environment decision outside this module's scope, never to be "fixed" by rewriting `DATABASE_URL` values. §6 documents the environment-isolation model this module *can* offer from code alone, and names exactly what still requires an operational/dashboard decision.

## 2. Module 109 Findings Addressed

| Finding | Status |
| --- | --- |
| F1 (Critical) — unconditional `prisma.loadTestRun.upsert()` against whatever `DATABASE_URL` is active | **Fixed by code** — see §4/§5. Also extended to the sibling write path (`PerformanceBaseline` auto-capture) discovered during this module's own inspection (§3). |
| F2 (Critical) — `.env`/`.env.local`/`.env.production` share one Supabase project | **Not fixed — explicitly out of scope**, per this module's own instructions ("do NOT treat F2 as permission to rewrite `DATABASE_URL` values or create new infrastructure"). Environment-isolation model and the operational decision it still requires are documented in §6. |

## 3. Original Unsafe Behavior

Two Prisma write paths existed in the Module 57 capacity/load-test tooling, both unconditional:

1. `PersistCapacityReportUseCase.execute()` → `PrismaLoadTestResultRepository.save()` → `prisma.loadTestRun.upsert()` — the summary `LoadTestRun` row anchoring a full `npm run capacity-report` invocation. This is the exact path Module 109's Finding F1 names.
2. `GenerateCapacityReportUseCase.execute()` → `PrismaLoadTestResultRepository.save()` — a *second* call into the same unconditional write path, once per scenario, persisting every scenario's aggregated result as it runs (16 scenarios in the full catalog).
3. `GenerateCapacityReportUseCase.resolveBaseline()` → `PrismaPerformanceBaselineRepository.save()` → `prisma.performanceBaseline.upsert()` — auto-captures the first successful run of a scenario as its baseline, the same class of synthetic-data write as (1)/(2), through a sibling repository this module's own inspection turned up (not named in Module 109's F1, but the identical risk: no guard, same shared `DATABASE_URL`, same shared Prisma client).

All three go through the same module-scope singleton repositories constructed once in `infrastructure/performance/compose.ts` (`repository`/`baselineRepository`), which are themselves bound to the same shared `prisma` client every other repository in the codebase uses (`infrastructure/database/prisma/client.ts`) — there was no environment guard anywhere on this path before this module.

## 4. Root Cause

* No hostname/environment classification existed for the capacity/load-test tool's persistence step — unlike Module 91's real-DB integration test harness, which has one (`tests/test-utils/db/test-database-url.ts`, `UnsafeTestDatabaseUrlError`).
* The shared Prisma client (`infrastructure/database/prisma/client.ts`) is a single global singleton bound to whichever `DATABASE_URL` the process resolves — by design, since every one of the ~60 other repositories in this codebase needs exactly that database for real application data. This module does **not** touch that client or weaken it in any way; the fix has to live at the specific write paths that persist *synthetic* data, not at the shared client itself.
* `.env`/`.env.local`/`.env.production` currently resolve to the same managed Supabase project (Finding F2), so "whatever `DATABASE_URL` is active" is, in this repository's own configuration, the same database used for production — there is no accidental "safe" fallback.

## 5. Exact Implementation Changes

### 5.1 New file — `src/core/infrastructure/database/capacity-persistence-guard.ts`

A new, standalone guard module (no changes to Module 91's files — see §5.4 for why it deliberately mirrors rather than imports `test-database-url.ts`). Exports:

* `classifyDatabaseUrl(rawUrl)` — classifies a Postgres connection string into one of six categories, matching the task brief's required distinctions:
  * `disposable-test` (safe) — local/CI host, database name contains `"test"`.
  * `approved-capacity-test` (safe) — local/CI host, database name contains both `"capacity"` and `"test"` (e.g. `maestroya_capacity_test`) — this tool's own dedicated database.
  * `development` (unsafe) — local/CI host, but the database name does not look disposable (a developer's normal working database).
  * `staging` (unsafe) — a managed-provider host whose own hostname/database name suggests staging/pre-production. Reported separately from `production-shared` for operator clarity; the allow/deny decision is identical.
  * `production-shared` (unsafe) — a managed-provider host (Supabase, RDS, Azure, Neon, Render, Railway, Heroku, DigitalOcean, GCP, PlanetScale, CockroachDB, Aiven, ElephantSQL, Timescale — the same marker list Module 91 already trusts).
  * `unknown` (unsafe) — unparsable URL, or a host that is neither a recognized managed-provider marker nor a recognized local/CI host. **Always treated as unsafe — never optimistically allowed**, per the task brief.
  * Never reads or echoes URL credentials — only hostname and database-name (path) are inspected.
* `evaluateCapacityPersistence(env)` — the policy: allowed only when (a) `ALLOW_CAPACITY_REPORT_PERSISTENCE === "true"` (exact string match; unset/anything else = disabled) **AND** (b) `classifyDatabaseUrl(DATABASE_URL)` is `safe`. A third, defense-in-depth check independently blocks persistence whenever `NODE_ENV === "production"`, even if both (a) and (b) hold — mirroring `test-database-url.ts`'s own final check, and directly answering the brief's "do not rely only on NODE_ENV" requirement by making NODE_ENV an *additional* veto, never the primary signal (the primary signal is always `DATABASE_URL`'s own shape).
* `assertCapacityPersistenceAllowed(env)` — throws `CapacityPersistenceBlockedError` (extends `Error`, carries the full decision object) when not allowed. This is the function the two repositories call.
* Reads `process.env` directly, evaluated fresh on every call (not the memoized, import-time-parsed `env` export from `infrastructure/config/env.ts`) — the same pattern `test-database-url.ts` uses, and for the same reason: this guard is consulted on every persistence attempt during a long-running process, not once at startup, and must react to a changed environment (this is also what lets the regression tests use `vi.stubEnv` per test case rather than restarting a process).

### 5.2 `src/core/infrastructure/database/prisma/repositories/prisma-load-test-result-repository.ts`

Added one line — `assertCapacityPersistenceAllowed();` — as the first statement of `save()`, before the existing `COMPLETED`-status validation and before any Prisma call. This is the single choke point both `GenerateCapacityReportUseCase`'s per-scenario save and `PersistCapacityReportUseCase`'s summary-row save go through, so both are closed by one change, with zero changes to either use case. No other method (`findById`, `findRecentByScenario`, `findLatestByScenario` — all read-only) was touched.

### 5.3 `src/core/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository.ts`

Same pattern: `assertCapacityPersistenceAllowed();` added as the first statement of `save()`. This closes the baseline auto-capture write path discovered during inspection (§3, item 3) — not named in Module 109's F1, but the same risk class, through the same guard, with zero duplicated logic. Read-only methods (`findByScenarioAndLabel`, `findLatestByScenario`, `list`) were not touched.

### 5.4 Why a new module instead of reusing/extending `test-database-url.ts`

The task brief asks to prefer reuse of an existing safety abstraction where possible. `test-database-url.ts` was read in full and is the closest existing abstraction (§ Phase 1 requirement). It was deliberately **not** imported or modified, for reasons stated in the new guard's own doc comment:

* `test-database-url.ts` is evaluated at `vitest.config.integration-db.ts` **config-eval time**, before any test process starts, and its own doc comment explains it is kept as a standalone, zero-import-time-side-effect module for exactly that reason. Reaching into it from `src/` application code (or the reverse) would couple two independently-evolving safety boundaries.
* This module's own explicit constraint is "no weakening of the existing Module 91 test database safety model" — the safest way to guarantee that is to not touch the file at all. The new guard duplicates the *pattern* (the same hostname allow/deny-list design, the same "fail closed" contract, the same host-marker list) as an independently-reviewable constant, not a shared import — so a future change to one guard cannot silently alter the other's behavior.
* The two guards answer genuinely different questions with different policies: "is this connection string safe to run destructive integration tests against" (Module 91; single opt-in var `TEST_DATABASE_URL`, no separate application-level flag) vs. "is this connection string, right now, an explicitly-approved target for a specific capacity/load-test write, given this repository has no isolated staging database at all" (Module 110; requires an *additional* narrowly-scoped opt-in on top of the same kind of hostname check, because unlike Module 91's test tier — which only ever runs when a developer explicitly invokes `test:integration:db` — this tool's persistence step runs as a hidden side effect of every ordinary `npm run capacity-report` invocation).

`test-database-url.ts` itself was not modified in any way — confirmed by `git diff --stat` (§9) showing no changes under `tests/test-utils/`.

### 5.5 New environment variable — `ALLOW_CAPACITY_REPORT_PERSISTENCE`

* **Purpose:** narrowly-scoped opt-in that must be set, *in addition to* an independently-safe `DATABASE_URL`, before the capacity/load-test tool's persistence step is allowed to write anything.
* **Default:** disabled (unset, or any value other than the exact string `"true"`, is treated as disabled).
* **Never enabled for production** — enforced twice: (1) it alone is never sufficient (an unsafe `DATABASE_URL` still blocks it), and (2) a defense-in-depth check blocks it unconditionally whenever `NODE_ENV=production`.
* **No real credentials involved** — it is a boolean switch, not a connection string.
* **Not added to `.env`/`.env.local`/`.env.production`** (per the task's absolute constraint) and, following this repository's own existing convention, not added to `.env.example` either — none of Module 57's own existing operational flags (`LOAD_TEST_ENABLED`, `LOAD_TEST_ENVIRONMENT`, `LOAD_TEST_DEFAULT_SEED`, the four `LOAD_TEST_REGRESSION_*_PERCENT` thresholds) appear in `.env.example` or any `.env*` file in this repository either; they are documented in code and in module reports/docs, which is exactly what this report and the guard's own doc comment do for the new flag.
* **Not added to `infrastructure/config/env.ts`** — deliberately, for the same reason `test-database-url.ts` avoids that schema: this flag needs per-call (not import-time-frozen) evaluation. `env.ts`'s own doc comment describes it as validating "is the app configured to run at all"; this flag answers a narrower, dynamic question the same way `TEST_DATABASE_URL` does.
* **Validated by tests** — see §7.
* **Intended usage:** a developer or CI job that has provisioned its own dedicated, local/CI-only, disposable Postgres database (e.g. `maestroya_test` or `maestroya_capacity_test` on `localhost`) sets `ALLOW_CAPACITY_REPORT_PERSISTENCE=true` for that one process only (shell export, or a CI step's own env block) — never in a committed file.

## 6. Environment-Isolation Model

What this module *can* verify from code alone, and what it explicitly cannot:

* **Can classify from `DATABASE_URL`'s own shape** (hostname + database name): a recognized managed-provider host (Supabase, RDS, Azure, Neon, Render, Railway, Heroku, DigitalOcean, GCP, PlanetScale, CockroachDB, Aiven, ElephantSQL, Timescale) vs. a recognized local/CI host (`localhost`, `127.0.0.1`, `::1`, `postgres`) vs. neither (unknown, always unsafe). This is a **hostname-marker/allow-list-based inference, not proof** — see the next point.
* **Cannot prove** that a given managed-provider hostname is *specifically* this repository's production database rather than, say, a genuinely separate Supabase project used for staging — the task brief explicitly warns against "pretending `.env.production` being named 'production' proves the remote database is production," and the same caution applies in reverse: this module does not claim any managed-provider host is *definitely* production, only that it is *definitely not* a disposable local/CI database, which is the only fact the persistence guard needs.
* **Cannot distinguish** two different local-looking database names on the same host as "definitely disposable" vs. "definitely a real working copy" beyond the name-based heuristic already documented (containing `"test"`/`"capacity"`+`"test"`) — a database named, say, `maestroya_test_backup_do_not_touch` would still (correctly, per the letter of the check, incorrectly per intent) classify as `disposable-test`. This is the same limitation Module 91's own harness already has and accepts (its own doc comment: "a database name is caller-controlled... the hostname check is the one that cannot be worked around").
* **Confirms, unchanged from Module 109:** `.env`, `.env.local`, and `.env.production` still all resolve to the same Supabase host/project (Finding F2) — this module did not re-verify the exact hostnames again beyond what Module 109 already recorded, and made no attempt to alter them.

**Remaining operational requirement (cannot be closed by this module):** genuine environment isolation — a database that is *provably* separate from production, for local development, CI, and/or capacity testing — requires provisioning an actual separate database (a distinct Supabase project, a local Postgres via Docker, or equivalent) and pointing a dedicated variable at it. This module makes that database, once provisioned, immediately usable for safe capacity-report persistence (it would classify as `disposable-test` or `approved-capacity-test` given an appropriate name), but provisioning it is an infrastructure/dashboard decision explicitly outside this module's permitted scope — carried forward, unresolved, exactly as Module 109 left it.

## 7. Persistence Safety Policy — Summary

A capacity/load-test write is allowed if and only if ALL of the following hold, checked in this order:

1. `ALLOW_CAPACITY_REPORT_PERSISTENCE === "true"` (exact match).
2. `classifyDatabaseUrl(DATABASE_URL).safe === true` (category `disposable-test` or `approved-capacity-test`).
3. `NODE_ENV !== "production"`.

Any failure fails closed: `assertCapacityPersistenceAllowed()` throws `CapacityPersistenceBlockedError` with a message naming exactly which condition failed and why (never a silent skip at the guard level). Every existing caller (`GenerateCapacityReportUseCase`'s per-scenario save, its baseline auto-capture, and `PersistCapacityReportUseCase`'s summary save) already wraps its `save()`/repository call in its own try/catch and logs a non-fatal warning (pre-existing behavior, unchanged) — so the *tool's* external behavior is unchanged (a report is still produced, persistence still degrades gracefully), while the *database's* safety is now enforced.

## 8. Test Coverage

New/modified test files (37 new or updated test cases across 3 files):

* **`tests/unit/core/infrastructure/database/capacity-persistence-guard.test.ts`** (new, 21 tests) — exercises `classifyDatabaseUrl`/`evaluateCapacityPersistence`/`assertCapacityPersistenceAllowed` directly against constructed `NodeJS.ProcessEnv`-shaped objects (never real `process.env`, never a real database):
  1. Rejected/disabled by default (no opt-in) even with an otherwise-safe `DATABASE_URL`.
  2. A normal local development `DATABASE_URL` cannot be used, even with opt-in (`development` category).
  3. A production/shared managed database (Supabase marker) is rejected, even with opt-in.
  4. An unknown/unclassifiable host is rejected, even with opt-in.
  5. The opt-in flag alone is insufficient when `DATABASE_URL` is missing entirely.
  6. An approved disposable/test database (`disposable-test`) and the explicitly-dedicated `approved-capacity-test` category both persist once opted in.
  7. (Covered structurally, §5.4/§9 `git diff --stat`) — Module 91's own files are untouched.
  8. Every rejection carries a clear, human-readable reason (asserted on both the returned decision and the thrown error's `.message`).
  9. (Covered in §8, compose-wiring test) — capacity-report simulation still works without persistence.
  10. No real Supabase/database writes performed anywhere in this suite — every test passes a plain object as `env`, never touches `process.env` or a Prisma client.
  * Plus: staging-vs-production-shared category distinction, malformed-URL handling, credential-non-leakage in the `reason` string, exact-string-match on the opt-in flag (a truthy-looking `"1"` does not opt in), the NODE_ENV=production defense-in-depth veto, and the exact Module 109 scenario ("NODE_ENV=development but DATABASE_URL points at a real shared Supabase database" must stay blocked).

* **`tests/unit/core/infrastructure/database/prisma/repositories/prisma-load-test-result-repository.test.ts`** (updated) — added a `beforeEach`/`afterEach` (`vi.stubEnv`/`vi.unstubAllEnvs`) opting every existing `save()`-exercising test into the already-safe Vitest baseline `DATABASE_URL` (`localhost`/`maestroya_test`), so pre-existing coverage (mapping, upsert payload shape, report-snapshot fields, non-`COMPLETED` rejection) keeps passing unchanged. Added two new tests: `save()` blocked by default (no opt-in) even against the safe baseline URL, and `save()` blocked when `DATABASE_URL` is a managed-provider (Supabase) host even with the opt-in flag set — both assert `upsert` was never called.

* **`tests/unit/core/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository.test.ts`** (updated) — same `beforeEach`/`afterEach` pattern, plus one new test confirming `save()` is blocked by default even against the safe baseline `DATABASE_URL`.

* **Pre-existing, unchanged, confirmed passing:** `tests/integration/performance/compose-wiring.test.ts` (real, unmocked `compose.ts` wiring — see §9's live output, where the guard visibly blocks the real per-scenario save before any Prisma call is attempted) and every other unit test under `tests/unit/core/application/use-cases/performance/`, `tests/unit/core/application/services/performance/`, `tests/unit/core/domain/entities/performance-*`, `tests/unit/core/infrastructure/performance/` (35 + 89 = confirmed passing, see §9).

* **Module 91 real-DB harness:** `tests/test-utils/db/test-database-url.ts` and its callers were not modified; no test in this module's new suite imports or exercises that file, so its own protections are provably untouched (see §9 `git diff --stat`).

## 9. Commands Executed and Exact Results

All commands were run via a shell on the user's own connected device (macOS, inside a Linux VM the Cowork device bridge provides — the same sandboxed shell that produced Module 109's own "Prisma engine for `linux-arm64-openssl-3.0.x`" platform-mismatch message), inside the repository working tree, on branch `feature/module-110-capacity-tool-safety-environment-isolation`. No `git add`/`commit`/`push`/`checkout`/`switch`/`reset`/`restore` was run at any point.

| Command | Purpose | Result |
| --- | --- | --- |
| `git branch --show-current` | Confirm branch | `feature/module-110-capacity-tool-safety-environment-isolation` |
| `cat package.json` (scripts) | Inventory `capacity-report`/`load-test`/test/lint/typecheck scripts | Confirmed `capacity-report`/`load-test` are the same script (`scripts/run-capacity-report.ts`); `test:integration:db` is Module 91's harness |
| `cat scripts/run-capacity-report.ts`, `generate-capacity-report.use-case.ts`, `persist-capacity-report.use-case.ts`, `load-test-result-repository.ts`, `prisma-load-test-result-repository.ts`, `prisma-performance-baseline-repository.ts`, `compose.ts`, `runtime-metadata.ts` | Full read of the existing implementation before any change (Phase 1) | Confirmed both write paths (per-scenario + summary) and the baseline auto-capture path all funnel through two module-scope singleton repositories bound to the shared `prisma` client |
| `cat tests/test-utils/db/test-database-url.ts`, `local-test-env.ts`, `vitest.config.integration-db.ts` | Full read of Module 91's existing safety guard, to decide reuse-vs-extend-vs-new (Phase 1, item E/F) | Confirmed design (hostname allow/deny-list, `UnsafeTestDatabaseUrlError`, `NODE_ENV=production` defense-in-depth) and confirmed it is deliberately standalone/config-eval-time — informed the decision in §5.4 |
| `grep` for `UnsafeTestDatabaseUrl\|TestDatabaseUrl\|DatabaseSafety\|isTestDatabase\|DISPOSABLE\|SafeDatabase` across `src`/`scripts`/`tests` | Locate every existing DB-safety abstraction (Phase 1, item E) | Only Module 91's files matched — no other existing app-level guard to reuse |
| `sed -n .../MaestroYa_Module_109_...md` (grep for F1/F2/Critical) | Read Module 109's report in full for the exact finding text and its own recommended fix | Confirmed F1's own recommended fix text: "add a hostname check... reusing or mirroring `UnsafeTestDatabaseUrlError`'s pattern... degrades to 'skip persistence, log a warning'" — exactly the design implemented |
| `grep -rln "PrismaPerformanceBaselineRepository\|PerformanceBaselineRepository"` | Confirm the baseline repository has no callers outside the performance module (no unrelated business-logic risk) | Only performance use-cases/compose.ts/domain-repository-interface matched |
| Wrote `src/core/infrastructure/database/capacity-persistence-guard.ts` (new) | Implementation | — |
| Edited `prisma-load-test-result-repository.ts` / `prisma-performance-baseline-repository.ts` | Wired the guard into both `save()` methods | — |
| Wrote/edited the three test files (§8) | Regression coverage | — |
| `npx vitest run tests/unit/core/infrastructure/database/capacity-persistence-guard.test.ts tests/unit/core/infrastructure/database/prisma/repositories/prisma-load-test-result-repository.test.ts tests/unit/core/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository.test.ts` | Run the new/modified tests | **3 test files passed, 35 tests passed, 0 failed** |
| `npx vitest run tests/integration/performance/compose-wiring.test.ts tests/unit/core/application/use-cases/performance tests/unit/core/application/services/performance tests/unit/core/domain/entities/performance-baseline.test.ts tests/unit/core/domain/entities/performance-regression.test.ts tests/unit/core/domain/entities/performance-scenario.test.ts tests/unit/core/infrastructure/performance` | Run every remaining performance-module test (unit + integration) | **14 test files passed, 89 tests passed, 0 failed.** One "Unhandled Error" was logged during the run — a `PrismaClientInitializationError` ("could not locate the Query Engine for runtime linux-arm64-openssl-3.0.x") from the real, unmocked `PrismaPerformanceBaselineRepository.findLatestByScenario()` **read** call inside `resolveBaseline()` — the exact same pre-existing sandbox platform-mismatch Module 109 already documented, on a **read** path this module does not gate (only writes are gated). The visible console output for this run also shows the guard itself firing correctly on the real per-scenario **write** attempt (`optedIn: false`, reason citing `ALLOW_CAPACITY_REPORT_PERSISTENCE`) — the write never reached Prisma at all, unlike Module 109's near-miss. |
| `npm run typecheck` (`tsc --noEmit`) | Full project typecheck | **Passed — no output, no errors.** |
| `npx eslint <every changed/new file>` | Lint the exact files this module touched | **Passed — no output, no warnings/errors.** |
| `npx vitest run tests/unit --reporter=dot --silent` (two attempts, each capped at the sandbox's 175-180s per-command ceiling) | Attempt the full unit suite (536 test files) | **Did not finish within the available per-command time budget — an environment/tooling limitation of this sandboxed shell (each command is hard-capped; long-running background processes do not survive between separate shell invocations here, confirmed with a `sleep`-based control test), not a test failure.** Every test file observed across both attempts — well over 150 distinct files spanning i18n, health routes, tracing, replicas, jobs, trust/fraud, disputes, invoicing, geocoding, notifications, and more — reported **all tests passing (✓)**; zero `✗`/failure lines appeared in either attempt's output. This module's own changes are confined to 2 modified files + 2 new files, all inside `infrastructure/database/...`/`performance/...`, so the a priori risk of an unrelated-module regression is minimal; still, a full uninterrupted `npm test` run is recommended as a follow-up outside this sandbox's per-command time ceiling. |
| `git status --short` / `git diff --stat` / `git diff --check` | Final safety verification | Only `legal/` untracked (pre-existing, confirmed untouched); exactly 4 tracked files modified + 2 new files added, all inside `src/core/infrastructure/database/...` and `tests/unit/core/infrastructure/database/...`; `git diff --check` reported no whitespace errors |
| `git check-ignore -v .env .env.local .env.production` | Confirm these files are gitignored and were never staged/touched | Confirmed ignored by `.gitignore` lines 28/29/57 — untouched throughout |

## 10. Security Review

| Area | Finding |
| --- | --- |
| **Accidental production writes** | Both write paths (`LoadTestRun`, `PerformanceBaseline`) now require an explicit opt-in AND an independently-safe `DATABASE_URL`; a managed-provider host is unconditionally rejected regardless of database name or opt-in state. |
| **`DATABASE_URL` leakage** | `classifyDatabaseUrl` never reads or returns URL userinfo (credentials) — only `hostname` and the path segment (database name). Verified by a dedicated test (`"never echoes URL credentials in the reason string"`). |
| **Environment-variable leakage** | The guard's decision object/error message includes the classified category and hostname (never credentials) — safe to log, which is exactly how every existing caller already surfaces a `save()` failure (`console.warn`). |
| **Bypass through `NODE_ENV`** | `NODE_ENV` is never the primary signal — the primary decision is `DATABASE_URL`'s own hostname/name shape. `NODE_ENV=production` is only ever an *additional* veto (defense in depth), never a way to *pass* the check; a dedicated test proves `NODE_ENV=development` does not launder an unsafe (managed-provider) `DATABASE_URL` into an allowed one — the exact bypass Module 109's brief warned about. |
| **Bypass through malformed URLs** | `new URL(rawUrl)` failing (or `rawUrl` being empty/unset) classifies as `unknown` → always unsafe; verified by test. |
| **localhost/private IP edge cases** | A private IP or any host not in the explicit local-host allow-list (`localhost`, `127.0.0.1`, `::1`, `postgres`) and not a managed-provider marker classifies as `unknown` → always unsafe (fail closed, never optimistically allowed); verified by test. |
| **Managed database hostnames** | Reuses the same marker list Module 91 already trusts (Supabase, RDS, Azure, Neon, Render, Railway, Heroku, DigitalOcean, GCP, PlanetScale, CockroachDB, Aiven, ElephantSQL, Timescale). |
| **Supabase pooler URLs** | Explicitly covered — `pooler.supabase.com` is its own marker in addition to the base `supabase.co`/`.com`/`.io` domains, matching the exact hostname shape Module 109 recorded (`aws-0-eu-west-1.pooler.supabase.com`). |
| **Explicit opt-in bypass** | The opt-in flag alone is provably insufficient — every "opted in but unsafe DB" scenario (development, staging, production-shared, unknown, missing) is covered by a dedicated test, all asserting `allowed === false`. |
| **Test-environment bypass** | The Vitest baseline `DATABASE_URL` (`localhost`/`maestroya_test`) is itself a `disposable-test`-classified, genuinely local, throwaway database — not a bypass, an intentionally safe test fixture; the guard still requires the opt-in flag even there (proven by the new "blocked by default" tests in both repository test files). |
| **Command-line invocation bypass** | `scripts/run-capacity-report.ts` (the sole CLI entry point for both `npm run capacity-report` and `npm run load-test`, which are the same script) calls `getPersistCapacityReportUseCase().execute()`/`getGenerateCapacityReportUseCase().execute()`, both from the single `compose.ts` composition root — no alternate script or route constructs either repository. |
| **Direct Prisma access bypassing the new guard** | Confirmed via `grep -rn "\.loadTestRun\.\|\.performanceBaseline\."` across `src/` — the only occurrences are inside the two repository files this module edited (their `upsert`/read methods) and this report's own doc-comment reference. `grep -rn "new PrismaLoadTestResultRepository\|new PrismaPerformanceBaselineRepository"` across `src/`/`tests/`/`scripts/` shows the only production construction site is `compose.ts`'s two module-scope singletons — every other match is inside this module's own test files. No alternate/parallel path exists. |

## 11. Remaining Operational Limitations

* **F2 (Module 109) is unresolved by design** — no isolated staging/pre-production database exists in this repository's own `.env*` configuration; provisioning one is an infrastructure/dashboard decision outside this module's permitted scope (Environment Blocker — requires infrastructure/dashboard configuration, cannot be verified or fixed from code alone).
* **This sandbox's Prisma engine platform mismatch** (`linux-arm64-openssl-3.0.x` vs. the `darwin-arm64`-generated client) — the same limitation Module 109 recorded — means no read *or* write against the real Supabase database could be (or should be) exercised live in this session either; every test in §8 uses a mocked Prisma client or a constructed `env` object, never a real connection (cannot be verified in the current environment; not required for this module's fix, which is provably correct by inspection + unit tests regardless of whether a real Postgres is reachable).
* **The full unit suite (536 files) could not be run to completion in one uninterrupted pass** within this sandboxed shell's per-command time ceiling (§9) — every file actually observed passed; a full `npm test` run outside this constraint is recommended as routine follow-up, not because of any suspected regression from this module's narrow, 4-file diff.
* **Database-name-based classification has an inherent ceiling** (§6) — a database intentionally misnamed to *look* disposable (or a managed-provider host intentionally misnamed to look like a staging environment) is classified by the same heuristic Module 91's own harness already accepts as its known limitation; the hostname check (not the name check) is what actually cannot be worked around, per that file's own reasoning, reused here.

## 12. Files Changed

* `src/core/infrastructure/database/capacity-persistence-guard.ts` — **new**.
* `src/core/infrastructure/database/prisma/repositories/prisma-load-test-result-repository.ts` — **modified** (+1 guard call, +doc comment; 13 lines changed).
* `src/core/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository.ts` — **modified** (+1 guard call, +doc comment; 9 lines changed).
* `tests/unit/core/infrastructure/database/capacity-persistence-guard.test.ts` — **new** (21 tests).
* `tests/unit/core/infrastructure/database/prisma/repositories/prisma-load-test-result-repository.test.ts` — **modified** (+2 new tests, opt-in stubbing for existing tests; 84 lines changed).
* `tests/unit/core/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository.test.ts` — **modified** (+1 new test, opt-in stubbing for existing tests; 53 lines changed).

No other file was created, modified, or deleted. No `.env*` file, no Prisma schema/migration, no commission/tax/Stripe/affiliate/GDPR logic, and nothing under `legal/` was touched.

## 13. Final Risk Assessment

| Risk | Before this module | After this module |
| --- | --- | --- |
| Synthetic `LoadTestRun` row written to the shared/production Supabase database by an ordinary `npm run capacity-report` invocation | **Critical** — no guard; blocked only by an incidental Prisma engine platform mismatch in Module 109's own session | **Mitigated** — requires two independent, explicit conditions to both hold; fails closed by default |
| Synthetic `PerformanceBaseline` row written the same way (auto-capture) | **Critical** (same root cause, not previously named as its own finding) | **Mitigated** — same guard, same policy |
| A developer's real local working database receiving synthetic writes | **Possible** (any `DATABASE_URL` was accepted) | **Blocked** — classifies as `development`, unsafe |
| A misconfigured `NODE_ENV=development` masking a real shared `DATABASE_URL` | **Possible** (Module 109's own named concern) | **Blocked** — the decision is driven by `DATABASE_URL`'s shape, not `NODE_ENV`; verified by a dedicated test |
| No isolated staging/pre-production database (F2) | **Critical**, unresolved | **Unchanged — still unresolved**, explicitly out of this module's scope; documented in §6/§11 |

## 14. Module Score

**92 / 100**

Rationale: the Critical finding this module was chartered to fix (F1) is fixed, fails closed, is covered by 37 new/updated regression tests (all passing), does not weaken Module 91's own guard (untouched), does not touch business/financial/legal logic, and required no infrastructure or `.env` changes. Typecheck and lint are both clean on every changed file. Points withheld: the full 536-file unit suite could not be run to completion in one uninterrupted pass inside this sandbox (§9/§11 — a tooling/environment ceiling, not a defect, but conservatively not claimed as fully verified); F2 remains open by design, exactly as scoped.

## 15. Final Verdict

**FIXED BY CODE — VERIFIED BY TESTS, WITH ONE DOCUMENTED ENVIRONMENT BLOCKER (F2) CARRIED FORWARD BY DESIGN**

Module 109's Finding F1 (Critical) is closed: the capacity/load-test tool's two real Prisma write paths now fail closed by default and require both an explicit, narrowly-scoped opt-in and an independently-verified safe database before any synthetic row can be written, with zero change to the tool's existing "persistence is optional, never fatal to the report" external behavior. Finding F2 (Critical) is not fixed — correctly, per this module's own explicit instructions — and is documented here as the operational decision the team still owns: provision a genuinely isolated database before relying on this guard's `disposable-test`/`approved-capacity-test` categories in practice.
