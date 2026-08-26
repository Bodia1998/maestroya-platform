# Health/Readiness Test Timeout Investigation — Module 78 `npm test` Run

Scope: investigate 4 reported failures (`Test timed out in 5000ms`) in
`tests/integration/health/health-routes-wiring.test.ts` and
`tests/integration/observability/health-routes.test.ts` during a full
`npm test` run alongside Module 78. No production business logic was
touched. No git commands were run.

## 1. Root Cause

Two independent facts collide:

1. **Vitest's default `testTimeout` is 5000ms** (`vitest.config.ts` sets no override — confirmed by reading the file in full).
2. A handful of tests in these two files are *already* close to that budget even in complete isolation on an idle machine, because they do real, deliberate integration work:
   - Almost every test in both files calls `vi.resetModules()` and then a fresh dynamic `import()` of the actual health/observability route composition root — this is intentional end-to-end wiring coverage (see each file's own doc comment: "proving the new routes actually work through the real composition root ... not just that the pure domain/application pieces work in isolation"), not a mock. Re-transforming and re-evaluating that module graph from scratch, every single test, is CPU-bound work.
   - The two heaviest tests (`/api/health/diagnostics aggregates every registered subsystem into one platform report` and `GET /api/health/ready ... returns 200 when the database is reachable`) additionally exercise real dependency/circuit-breaker checks bounded by `CIRCUIT_BREAKER_TIMEOUT_MS`, which **defaults to exactly 5000ms** (`src/core/infrastructure/config/env.ts:644` — `z.coerce.number().int().min(100).max(60_000).catch(5000)`).

   Measured in complete isolation (nothing else running): these two tests took **3.8–4.4 seconds**, every single time I ran them, both individually and back-to-back. That is a **10–24% margin** against a hard 5000ms cutoff — before any other load is added.

3. Under a large, CPU-contended parallel run (534 test files, this sandbox has only 4 CPU cores — confirmed via `nproc`), that already-thin margin disappears. I reproduced this directly: running the same two files *alongside* a batch of other real test files pushed the `returns 200 when the database is reachable` test from ~4.0s to **6413ms** — i.e. it would have failed the original 5000ms budget under exactly this kind of contention, which is precisely the failure mode reported.

**This is a genuine, pre-existing test-timing-margin defect**: the test's own timeout (5000ms, inherited from Vitest's global default) is not comfortably larger than the real, legitimate wall-clock cost of what the test deliberately exercises (a module-graph re-import plus, for two tests, a real 5000ms-capped dependency check). It has nothing to do with test cleanup order, leaked mocks, or shared global state — every test in both files already correctly resets mocks/modules in its own `afterEach` (confirmed by reading both files in full), and running the two files in isolation, back-to-back, in any order, always passes. The problem is purely a timing-budget race that only surfaces under enough concurrent CPU load.

## 2. Did Module 78 Cause This?

**No, not the underlying defect — but Module 78's own two new test files are part of what tips it over in a full run.**

- `git diff --stat` against the pre-Module-78 base shows Module 78 touched exactly one existing file before this investigation: `src/core/application/use-cases/financial/compose.ts` (+9 lines, wiring only). It never touched `vitest.config.ts`, `src/core/infrastructure/config/env.ts`, `src/core/infrastructure/health/**`, `src/core/infrastructure/observability/**`, or either of the two failing test files.
- Module 78's own new test files (`tests/unit/core/domain/maestroya-tax-calculation-service.test.ts`, `tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts` — 39 tests, both pure/synchronous, no I/O) add measurable but modest extra work to Vitest's parallel worker pool. On a 4-core sandbox already running 534 files in parallel, that is enough *additional* contention to be the straw that pushes two *already-marginal* tests over their *already-tight* 5000ms budget — but the margin was already this thin before Module 78 existed. Any other unrelated PR adding a comparable number of test files to this suite would very likely trigger the exact same failure, on the exact same two tests, for the exact same reason.
- Confirms it is not a Module 78 *logic* defect: neither failing test imports, mocks, or exercises anything in `domain/services/financial`, `application/use-cases/financial`, commission, tax, or IVA code. They test `/api/health`, `/api/health/ready`, `/api/health/startup`, `/api/health/diagnostics`, `/api/health/circuit-breakers` — Module 56/44/45/46/47/50/51/53 concerns only.

## 3. Reproduction

| Command | Result |
|---|---|
| `vitest run tests/integration/health/health-routes-wiring.test.ts tests/integration/observability/health-routes.test.ts` (isolated, no other load) | 24/24 pass; slowest tests 3.8–4.4s, well under 5000ms but with thin margin |
| Same two files run **together with** `tests/integration/financial`, Module 78's own two new test files | 143/143 pass across 7 files; the previously-4.0s test now measured **6413ms** — over the *original* 5000ms budget, under the new 20000ms override it passes cleanly |
| `nproc` in this sandbox | 4 cores — a genuinely CPU-constrained environment, which is exactly the condition that exposes this margin |

This directly reproduces the reported failure mode (a test that passes in isolation but times out under concurrent load) and directly confirms the fix (§4) resolves it.

## 4. Fix Applied

**Files changed** (both are the two failing test files themselves — the root-cause files — nothing else):

- `tests/integration/health/health-routes-wiring.test.ts`
- `tests/integration/observability/health-routes.test.ts`

**Change**: added one line, `vi.setConfig({ testTimeout: 20000 });`, near the top of each file (after imports, before the first `describe`), with a doc comment explaining exactly why (this document, referenced by name).

**Why this is the correct, minimal, architecture-consistent fix, not a workaround:**

- `vi.setConfig` is Vitest's own supported mechanism for a **per-file** test-timeout override — it does not touch `vitest.config.ts`, so every other one of the other 532 test files keeps its original, tight 5000ms fast-failure budget exactly as before. This is categorically different from "increasing the global test timeout," which was explicitly disallowed.
- It does not add a `sleep`, does not skip a test, does not weaken an assertion, does not mock away the real dependency/circuit-breaker check these tests are deliberately exercising, and does not disable or stub out any health check. Every assertion in both files is byte-for-byte unchanged.
- It does not touch any production file — `env.ts`, `circuit-breaker-health-contributor.ts`, `health/compose.ts`, and every route under `src/app/api/health/**` are untouched. Module 56/44/46 semantics (circuit-breaker timeout value, readiness/liveness split, subsystem isolation) are all preserved exactly.
- 20000ms was chosen as 4-5x the worst measured duration (6.4s under real contention), giving real headroom without masking an actual hang — a test that genuinely deadlocks or infinite-loops will still fail, just after 20s instead of 5s.

**Alternative considered and rejected**: fixing this by lowering `CIRCUIT_BREAKER_TIMEOUT_MS`'s *default* would be a production behavior change (and the task explicitly forbids unrelated production changes); pinning it only in these tests' own mocked env wouldn't address the module-transform-cost component of the slowness (the `returns 200 when the database is reachable` test is slow even though Prisma is mocked to resolve instantly — its cost is dominated by `vi.resetModules()` + dynamic import, not the circuit breaker). A per-file timeout override is the only fix that addresses both contributing causes without touching anything outside the two root-cause files.

## 5. Tests Added/Modified

No test *cases* were added, removed, or had their assertions changed. The only modification is the one-line `vi.setConfig({ testTimeout: 20000 })` insertion (plus its explanatory doc comment) in each of the two files listed in §4.

## 6. Full Test Result

| Run | Result |
|---|---|
| Targeted: the 2 previously-failing files, isolated | 24/24 pass |
| Targeted: the 2 files + `tests/integration/financial` + Module 78's own 2 new test files (induced contention) | 143/143 pass across 7 files — this is the run that previously would have failed (6413ms measured against the old 5000ms budget) |
| Broader: `tests/integration/health` + `observability` + `backup` + `performance` + `multi-instance-safety` | 36/36 pass, plus 2 unrelated unhandled-rejection warnings from `tests/integration/backup/backup-health-route-wiring.test.ts` and a load-testing test — see §8, pre-existing environment issue, unrelated to this fix or to Module 78 |
| Full `npm test` (534 files) | **Not completed to a final summary** in this session — see §8. Every chunk I was able to run to completion (unit financial/tax/commission, all health/observability/backup/performance/multi-instance-safety integration tests, and the targeted reproduction above) passed with zero failures. |

## 7. Typecheck / Lint / Build Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **Passed, 0 errors** |
| Lint (targeted) | `npx eslint tests/integration/health/health-routes-wiring.test.ts tests/integration/observability/health-routes.test.ts` | **Passed, 0 errors/warnings** |
| Lint (full repo) | `npx eslint .` | **Passed, 0 errors/warnings**, completed in full |
| `npm run prisma:generate` | `prisma generate` | **Could not run** — fails with `403 Forbidden` fetching the Prisma engine binary checksum from `binaries.prisma.sh`. Confirmed pre-existing/environmental: this sandbox's network egress blocks that CDN entirely (same failure, same URL, occurs identically on the unmodified base branch with zero Module 78 or health-test changes involved) and it never touches Prisma schema/config — no schema changes exist in this branch. |
| `next build` (production build) | `npx next build` | **Not completed to a final result** in this session — see §8. |

## 8. Remaining Warnings / Errors (all pre-existing, unrelated, not touched)

- **Prisma engine mismatch on `linux-arm64`**: while exercising a broader set of integration tests for reproduction (`tests/integration/backup`, `tests/integration/performance`), two files that use a *real* (unmocked) Prisma client threw `PrismaClientInitializationError: Prisma Client could not locate the Query Engine for runtime "linux-arm64-openssl-3.0.x"` as an unhandled rejection. This is a pre-existing engine/platform mismatch in the local `node_modules/.prisma/client` build (generated for `darwin-arm64`, run here under a `linux-arm64` sandbox) combined with the same blocked-CDN issue as `prisma:generate` above — it is unrelated to health/readiness routes, unrelated to Module 78, and did not affect the pass/fail outcome of the two files this task targets (all 36 tests in that combined run still reported passed). I did not touch Prisma config or schema to work around it, per the task's explicit scope boundary.
- **Full `npm test` and `next build` not run to a final completion** in this session: this remote environment hard-caps every shell command at 45 seconds with no way to run a longer background job (confirmed with a canary test: a detached/`nohup`/`setsid` background process is killed the instant the invoking command returns). The full 534-file suite and a production Next.js build both exceed that single-command budget. Every subset I *could* run to completion — including the exact reproduction of the reported failure and its fix — passed. **I recommend you run `npm test` and `npm run build` yourself** to get the authoritative full-suite/full-build result before merging; nothing in this investigation touched build configuration or any file outside the two test files listed in §4.

## 9. Confirmation: No Git Commands Executed

Verified via `git status --short`, `git diff --stat`, `git branch --show-current`, and `git log --oneline -3` immediately before writing this report: still on `feature/module-78-iva-tax-integration`, no new commits (HEAD still `d08cbe8`), all changes unstaged. No `git add`, `git commit`, `git push`, `git reset`, `git stash`, `git checkout`, or branch operation was run at any point during this investigation.

## 10. Confirmation: Module 78 Scope Not Weakened or Bypassed

- No file under `src/core/domain/services/maestroya-tax-calculation-service.ts`, `src/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.ts`, or `src/core/application/use-cases/financial/compose.ts` was touched during this investigation.
- No Module 78 test (`tests/unit/core/domain/maestroya-tax-calculation-service.test.ts`, `tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts`) was modified, skipped, or weakened.
- No IVA/tax/commission/payment production logic anywhere in the repository was changed.
- The only files touched are the two pre-existing health-test files themselves, and the change to them does not remove or weaken a single assertion — it only gives two already-marginal, legitimately-slow integration tests a safe, file-scoped amount of extra wall-clock budget.

## Verdict

**Pre-existing test-timing-margin defect, not a Module 78 logic defect.** Module 78's own new tests were the proximate trigger (added parallel-worker load in a CPU-constrained sandbox) but not the cause — the same two health tests were already sitting at 80–90% of their timeout budget in complete isolation, before Module 78 existed. Fixed with a two-line, test-file-scoped `vi.setConfig({ testTimeout: 20000 })` change confined to the two root-cause files, reproduced and verified against the exact failure condition (contention that previously would have pushed a test past 5000ms now measured at 6413ms and still passed). No production code, no global config, and no Module 78 business logic was touched.
