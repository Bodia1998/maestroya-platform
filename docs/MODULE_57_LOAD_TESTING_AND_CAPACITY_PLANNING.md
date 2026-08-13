# Module 57 — Load Testing & Capacity Planning

## 1. Purpose

Modules 54-56 give this platform backup/disaster-recovery, read-replica scaling, and health/circuit-breaker observability. What was still missing is a way to answer, before a real incident forces the question: *how much traffic can this platform actually take, and where does it break first?*

Module 57 is explicitly **not** external benchmarking. There is no k6/Gatling/JMeter-style harness here, no real HTTP calls out of the process, and no real call to Stripe. Instead, this module simulates realistic workloads **in-process**, deterministically and seedably, and turns the simulated results into a production-readiness sign-off artifact: latency/throughput/resource-usage numbers, capacity projections at 100 through 100,000 concurrent users, scaling recommendations, and regression detection against a captured baseline.

Four concrete capabilities:

1. **Scenario simulation** — a code-defined catalog of 16 realistic workload shapes (registration, auth, search, booking, messaging, a mock Stripe payment flow, and more), each executed by a deterministic, seeded in-process simulator (`BenchmarkRunner`).
2. **Load test results** — one `LoadTestResult` aggregate per execution, with a `PENDING → RUNNING → COMPLETED | FAILED` lifecycle, computed `LatencyStatistics` (average/median/p95/p99), throughput, and an estimated resource footprint.
3. **Baselines & regression detection** — a `PerformanceBaseline` snapshot mechanism and `PerformanceRegression` computation that flags a later run as `MINOR`/`MODERATE`/`SEVERE`/`CRITICAL` worse than a captured baseline, per metric.
4. **Capacity planning & reporting** — `CapacityPlanningService` extrapolates a scenario's measured behaviour out to `100`/`500`/`1,000`/`5,000`/`10,000`/`50,000`/`100,000` concurrent users, `PerformanceAnalysisService` identifies bottlenecks and computes a `productionReadinessScore` (0-100), and `report-generator.ts` renders the whole thing as a structured object, Markdown, and JSON.

Module 57 is a **dev/CI-only engineering tool, not production business logic**, and still has **no API route, no queue, no worker, and no scheduler** — but it does persist **aggregated** results: every scenario's computed `LoadTestResult` (never raw per-request samples — see §5) is saved as a `LoadTestRun` row, and `PerformanceBaseline`s persist so later runs automatically compare against them without a caller supplying one. The primary way to actually run it is `npm run capacity-report` (alias `npm run load-test`), a CLI script that runs the full 16-scenario catalog, writes `reports/capacity-report.md` and `reports/capacity-report.json` to the project root, and persists both the per-scenario evidence and the report-anchoring row via the database.

`LOAD_TEST_ENABLED` (default `false`) is a kill switch an operator/CI step can check before invoking the CLI — every use case is fully functional regardless, because this module holds no background machinery, and no database connection, to gate (see §5).

## 2. Architecture

```
domain/entities/
  performance-scenario.ts     PerformanceScenario, ScenarioCategory, WorkloadProfile
  load-test-result.ts         LoadTestResult (state-machine aggregate), ResourceEstimate
  performance-baseline.ts     PerformanceBaseline (immutable snapshot)
  performance-regression.ts   PerformanceRegression, MetricRegression, RegressionSeverity
  capacity-report.ts          CapacityReport, CapacityProjection, CapacityRecommendation
domain/value-objects/
  latency-distribution.ts     LatencyStatistics (hand-rolled percentile math)
domain/errors/domain-error.ts InvalidLoadTestTransitionError, InvalidWorkloadProfileError

application/ports/
  load-test-executor.ts        LoadTestExecutor, RawExecutionSample, LoadTestExecutionOutcome
application/services/performance/
  performance-scenario-catalog.ts   the 16-scenario code-defined catalog
  load-testing-service.ts           run a scenario, aggregate samples — entirely in memory
  capacity-planning-service.ts      per-tier extrapolation + recommendations
  baseline-comparison-service.ts    baseline vs. result -> PerformanceRegression
  performance-analysis-service.ts   bottlenecks + productionReadinessScore
application/use-cases/performance/
  execute-load-test.use-case.ts
  compare-performance-baseline.use-case.ts        explicit baseline, or falls back to the stored one
  detect-performance-regression.use-case.ts       in-memory results[]/baselines[], or falls back to the repositories
  generate-capacity-report.use-case.ts            runs the catalog, persists per-scenario evidence, builds a CapacityReport
  persist-capacity-report.use-case.ts             persists the single report-anchoring LoadTestRun row

domain/repositories/
  load-test-result-repository.ts       LoadTestResultRepository — aggregated LoadTestRun persistence
  performance-baseline-repository.ts   PerformanceBaselineRepository

infrastructure/database/prisma/repositories/
  prisma-load-test-result-repository.ts       Prisma-backed LoadTestResultRepository
  prisma-performance-baseline-repository.ts   Prisma-backed PerformanceBaselineRepository

infrastructure/performance/
  performance-config.ts        resolvePerformanceConfig() from env
  benchmark-runner.ts          BenchmarkRunner — the LoadTestExecutor: seeded, in-process simulator
  metrics-collector.ts         estimateResourceUsage() — concurrency+category -> ResourceEstimate
  report-generator.ts          buildStructuredReport()/renderMarkdownReport()/toJsonReport()
  runtime-metadata.ts          resolveRuntimeMetadata() — git commit/branch, app version, environment
  compose.ts                   composition root — repositories wired as module-scope singletons

scripts/run-capacity-report.ts  npm run capacity-report / npm run load-test — the CLI entry point
```

This module persists **aggregated results only** — see §5's "Persistence" subsection. It mirrors Module 54's shape closely: a single swappable port (`LoadTestExecutor`, playing the role `DatabaseBackupProvider` plays for backup), pure application services, a repository pair, and a composition root. There is still deliberately **no queue, no worker, no scheduler, and no API route** — a load test remains a synchronous, in-process, on-demand simulation, never long-running background machinery; see §5.

## 3. Domain model

### Scenarios and workload profiles

`PerformanceScenario` names a `ScenarioCategory` (16 values, from `USER_REGISTRATION` through `MIXED_WORKLOAD`) and carries a `WorkloadProfile` — `virtualUsers`, `durationSeconds`, `rampUpSeconds`, `requestsPerUserPerSecond` — self-validating in its own constructor (`InvalidWorkloadProfileError` on anything non-positive, or a ramp-up longer than the run itself). The full catalog of 16 scenarios ships as reviewed, deployed **code** (`performance-scenario-catalog.ts`), not a database table — identical reasoning to Module 54's `disaster-recovery-plans.ts`: a workload definition is exactly as load-bearing as code, and an admin-editable scenario would make one month's capacity report incomparable to the next's.

`STRIPE_PAYMENT_FLOW` is explicitly named "Stripe Payment Flow (mock implementation)" in its own catalog entry — it simulates the *shape and timing* of a payment-intent create → confirm → webhook round trip (including a bimodal "occasionally waiting on the gateway" latency tail), never a real Stripe API call.

### Load test results

`LoadTestResult` is a small state machine (`PENDING → RUNNING → COMPLETED | FAILED`), constructed only via `LoadTestResult.schedule()`, mirroring `BackupRecord`'s "aggregates come from a named factory, transitions are guarded on the aggregate itself" convention exactly, down to the `ALLOWED_TRANSITIONS` table and a dedicated `InvalidLoadTestTransitionError`. `markCompleted` accepts `LatencyStatistics`, throughput, a `ResourceEstimate`, and request/failure/timeout/retry counts, and rejects (throwing the same error) a completion where `failedRequests` exceeds `totalRequests`. `errorRate`/`timeoutRate`/`retryRate` are derived getters, always `0` (never `NaN`) for a run with zero requests.

### Latency statistics

`LatencyStatistics.fromSamples()` computes min/max/average/median/p95/p99 from raw latency samples using the same nearest-rank percentile method most load-testing tools (k6, Gatling) report by default, implemented inline — no statistics dependency, the same "small, well-understood math belongs in the domain layer" convention `RetentionPolicy.expiryDateFor` establishes for Module 54.

### Baselines and regressions

`PerformanceBaseline.capture()` snapshots a `COMPLETED` `LoadTestResult`'s metrics under a caller-chosen `label`, refusing (with `ValidationError`) to capture from anything else — a baseline captured from a failed or still-running result would silently poison every future comparison. `PerformanceRegression.compute()` diffs a baseline against a later result across four metrics (p95/p99 latency, error rate — higher is worse; throughput — lower is worse), classifies each metric's percentage-worse change against configurable thresholds (`MINOR`/`MODERATE`/`SEVERE`/`CRITICAL`), and reports the worst as `overallSeverity`.

### Capacity reports

`CapacityReport` aggregates `CapacityProjection`s (one per scenario per tier in `CAPACITY_USER_TIERS = [100, 500, 1000, 5000, 10000, 50000, 100000]`), a list of `CapacityRecommendation`s (category: `DATABASE_SCALING`/`READ_REPLICAS`/`REDIS_SCALING`/`HORIZONTAL_INSTANCES`/`STORAGE`/`BANDWIDTH`/`WORKER_COUNT`/`QUEUE_THROUGHPUT`), a ranked `bottlenecks` list, and a `productionReadinessScore` (0-100). `CapacityReport.isProductionReady` is a documented cut line: score `>= 70` **and** no bottleneck with an error rate above 5%.

## 4. Application layer

`LoadTestExecutor` (`application/ports/load-test-executor.ts`) is the seam application code depends on for actually running a scenario — the same Dependency Inversion boundary `DatabaseBackupProvider` draws for Module 54. `LoadTestingService.run()` schedules a `LoadTestResult` as `PENDING`, transitions to `RUNNING`, calls the executor, aggregates the returned raw samples into `LatencyStatistics`/throughput/error-rate, and marks `COMPLETED` — the raw samples themselves are discarded the moment they're aggregated and never leave this method. A caller who omits a seed still gets full determinism: the service derives a stable seed from the run's own generated id, never falling back to `Math.random()`. `LoadTestingService` itself stays persistence-free; `GenerateCapacityReportUseCase` (below) is the layer that saves the aggregate it returns.

`CapacityPlanningService.projectForScenario()` extrapolates a scenario's *measured* behaviour, at the concurrency its `WorkloadProfile` actually simulated, to every tier — throughput and memory scale linearly with the concurrency ratio, CPU/DB-pool utilization scale linearly but capped at 100%, and p95 latency scales **sub-linearly** (`1 + log2(ratio) * 0.35`) to avoid a naive linear model wildly overstating latency at the largest tiers. `recommendationsFor()` turns threshold crossings (CPU ≥ 80%, DB pool ≥ 85%, memory ≥ 4GB/instance) into typed recommendations, distinguishing `DATABASE_SCALING` (a `DATABASE_INTENSIVE` scenario) from `READ_REPLICAS` (everything else), and flags cache-reliant categories (`SEARCH`/`BROWSE_PROFESSIONALS`/`MIXED_WORKLOAD`) for `REDIS_SCALING` review regardless of measured pressure.

`PerformanceAnalysisService.identifyBottlenecks()` ranks scenarios exceeding a p95-latency or error-rate threshold, worst first, capped at 5. `computeProductionReadinessScore()` starts at 100 and deducts a documented, fully-transparent penalty per bottleneck (weighted by how far past threshold) and per regression severity — no black-box formula.

Five use cases: `ExecuteLoadTestUseCase` resolves a scenario id against the catalog and delegates to `LoadTestingService` — no persistence, a single ad hoc run. `ComparePerformanceBaselineUseCase` compares a `LoadTestResult` against a `PerformanceBaseline`; the caller may supply the baseline explicitly (an arbitrary two-way comparison, e.g. one re-loaded from a previous report's JSON output), or omit it and let the use case resolve the scenario's stored baseline via `PerformanceBaselineRepository` — by a specific `baselineLabel` or, by default, the most recently captured one — throwing `NotFoundError` only when neither an explicit baseline nor a repository/stored baseline is available. `DetectPerformanceRegressionUseCase` resolves "most recent completed result" and "most recently captured baseline" for a `scenarioId`, preferring caller-supplied in-memory `results[]`/`baselines[]` when given and falling back to `LoadTestResultRepository`/`PerformanceBaselineRepository` lookups otherwise; it returns `null` (never throws) when either is missing by any path — the same "a status read must never itself fail for an unexceptional reason" contract `GetBackupStatusUseCase` follows. `GenerateCapacityReportUseCase` is the main entry point: it runs every requested scenario through `LoadTestingService`, persists each scenario's aggregated result via `LoadTestResultRepository.save()` (non-fatal on failure), resolves each scenario's comparison baseline the same way `ComparePerformanceBaselineUseCase` does — explicit input first, then the stored baseline — and, when neither exists, **auto-captures the scenario's first successful run as its baseline** (under `AUTO_CAPTURED_BASELINE_LABEL = "auto-captured"`) so the next run has something to compare against; it then projects and recommends via `CapacityPlanningService`, folds in regression severity, and returns both the assembled immutable `CapacityReport` and the raw `LoadTestResult[]` it was built from. `PersistCapacityReportUseCase` persists the single `LoadTestRun` row that anchors a full report run — a synthetic aggregate (under the reserved scenario id `CAPACITY_REPORT`) built purely from the already-aggregated per-scenario results, carrying `productionReadinessScore`/`bottlenecks`/`recommendations`/`reportJson`/`reportMarkdown`; see that use case's own doc comment for the exact aggregation rule per field. A scenario whose run fails is skipped, not fatal to the report as a whole. Every repository dependency across these use cases is an **optional** constructor parameter — all five remain fully functional, in-memory only, with none configured.

## 5. Infrastructure layer

### BenchmarkRunner — the in-process simulator

`BenchmarkRunner` is the only `LoadTestExecutor` implementation this module ships. It never makes a real network call, never touches the real database, and never talks to Stripe. Every random decision — latency jitter, failure/timeout/retry rolls — is driven by `mulberry32`, a small, fast, public-domain 32-bit PRNG implemented inline (no new dependency, matching this codebase's "hand-roll small, well-understood algorithms" convention). The same `(scenario, seed)` pair always produces the same samples: `execute()` constructs a fresh PRNG from the seed on every call, so a capacity report is exactly reproducible for review.

Each `ScenarioCategory` carries its own `LatencyProfile` (base latency, jitter, a per-virtual-user concurrency penalty, and failure/timeout/retry probabilities) — a `DATABASE_INTENSIVE` scenario is modelled with materially higher and wider latency than `BROWSE_PROFESSIONALS`, and `STRIPE_PAYMENT_FLOW` carries an extra bimodal "slow tail" probability to mimic waiting on an external gateway. Sample counts are bounded at `MAX_SIMULATED_SAMPLES = 3000` regardless of how large a `WorkloadProfile` requests, keeping simulation cost flat.

### metrics-collector.ts — resource estimation

`estimateResourceUsage()` turns concurrency and scenario category into a `ResourceEstimate` — **estimates for capacity-planning purposes, explicitly never measured OS/DB/cache metrics**, since there is no real process, database, or cache being exercised. Every per-category coefficient is a documented linear model: CPU/memory/DB-pool-utilization all grow with `virtualUsers` at a category-specific rate, and `cacheHitRatioPercent` is a roughly-constant property of the category (high for read-heavy `BROWSE_PROFESSIONALS`, near-zero for write-heavy `DATABASE_INTENSIVE`) that degrades as the simulated error rate rises.

### report-generator.ts

`buildStructuredReport()` combines a `CapacityReport` with the `LoadTestResult[]` it was built from into one structured object — overall score, production-ready flag, a traffic-light `readinessStatus` (`Green` ≥90, `Yellow` 70-89, `Red` <70), a per-scenario metrics row (average/median/p95/p99/throughput/error rate/PASS-or-FAIL), the per-tier capacity projections, bottlenecks, and recommendations. `renderMarkdownReport()` renders the same as the plain-text Markdown report this module's CLI writes to `reports/capacity-report.md` (one fenced block per scenario, one section per capacity tier, a closing production-readiness section), and `toJsonReport()` returns the identical data as a JSON-serializable object, written to `reports/capacity-report.json`.

### Persistence — aggregated only, restored after a prior stateless pass

`domain/repositories/load-test-result-repository.ts` (`LoadTestResultRepository`) and `performance-baseline-repository.ts` (`PerformanceBaselineRepository`) are the repository ports; `infrastructure/database/prisma/repositories/prisma-load-test-result-repository.ts`/`prisma-performance-baseline-repository.ts` are their Prisma implementations, mapping to/from the `LoadTestRun`/`PerformanceBaseline` tables in `prisma/schema.prisma`. Both tables store **only already-computed aggregates** — a `LoadTestResult` never holds a raw per-request latency array to begin with (only `LatencyStatistics`, six numbers — see §3), so persisting the aggregate the domain layer already produces never risks writing raw samples to the database. `LoadTestRun` rows come in two flavours: most are one per scenario execution (`productionReadinessScore`/`bottlenecks`/`recommendations`/`reportJson`/`reportMarkdown` all `null`), and at most one per `npm run capacity-report` invocation additionally anchors the full report (those columns populated, via `PersistCapacityReportUseCase`). `infrastructure/performance/runtime-metadata.ts` resolves the git commit/branch (via a read-only `git rev-parse`, wrapped so a missing `git`/non-repo checkout degrades to `null` rather than failing), app version (`package.json`), and environment (`LOAD_TEST_ENVIRONMENT`/`NODE_ENV`) stamped onto that anchor row.

Every persistence call across this module's use cases is optional and non-fatal: `GenerateCapacityReportUseCase`/`PersistCapacityReportUseCase` catch and log (`console.warn`) any repository failure rather than letting it fail a report — a database outage must never prevent `npm run capacity-report` from producing its Markdown/JSON files.

### scripts/run-capacity-report.ts — the CLI entry point

`npm run capacity-report` (alias `npm run load-test`) runs `tsx --conditions=react-server scripts/run-capacity-report.ts` — the same runner/condition Module 48's `realtime:gateway` script uses, since `compose.ts` is `"server-only"`. The script calls `getGenerateCapacityReportUseCase()` (which persists each scenario's aggregated evidence and resolves/auto-captures its baseline as it runs — see §4), runs the full 16-scenario catalog, renders both Markdown and JSON via `report-generator.ts`, writes `reports/capacity-report.md`/`reports/capacity-report.json` (creating `reports/` if absent — gitignored, generated output), persists the report-anchoring row via `getPersistCapacityReportUseCase()` (wrapped in its own try/catch — a persistence failure here is logged as a warning and never prevents the files from being written or the script from exiting successfully), and prints a short summary (overall score, production-ready yes/no, bottleneck count) to stdout. This remains the only way to produce a capacity report: there is no API route, so every run is still a fresh, on-demand CLI invocation — it now simply also leaves a durable, queryable trail behind.

### Why there is still no queue, worker, or scheduler

Unlike Module 54's backup pipeline, a load test is an in-process simulation triggered on demand — by an operator, or a CI/release-readiness step — not a long-running external process needing background orchestration. `ExecuteLoadTestUseCase.execute()`/`GenerateCapacityReportUseCase.execute()` run synchronously to completion and return their results directly; `compose.ts` has no `registerScheduled*()` and no `__testing.worker` escape hatch to expose — only a lazy `BenchmarkRunner` singleton, two module-scope repository singletons (mirroring `infrastructure/backup/compose.ts`'s own `repository`), and use-case getters, reset via `__testing.reset()`.

## 6. Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOAD_TEST_ENABLED` | `false` | A kill switch an operator/CI step can check before invoking `npm run capacity-report` — every use case is functional regardless (see §5); this module has no route or background process to gate. |
| `LOAD_TEST_DEFAULT_SEED` | `42` | The PRNG seed `BenchmarkRunner` falls back to when nothing else pins one — fixed, not random, so a no-argument run is itself reproducible by default. |
| `LOAD_TEST_REGRESSION_MINOR_PERCENT` | `10` | Percentage-worse threshold for a `MINOR` regression. |
| `LOAD_TEST_REGRESSION_MODERATE_PERCENT` | `25` | Percentage-worse threshold for a `MODERATE` regression. |
| `LOAD_TEST_REGRESSION_SEVERE_PERCENT` | `50` | Percentage-worse threshold for a `SEVERE` regression. |
| `LOAD_TEST_REGRESSION_CRITICAL_PERCENT` | `100` | Percentage-worse threshold for a `CRITICAL` regression. |
| `LOAD_TEST_ENVIRONMENT` | unset (falls back to `NODE_ENV`) | Optional, free-text environment label stamped onto the report-anchoring `LoadTestRun` row by `runtime-metadata.ts` — not schema-validated in `env.ts` (no other module in this codebase needs it), simply read directly via `process.env`. |

The four `LOAD_TEST_REGRESSION_*_PERCENT` variables are cross-validated in `env.ts`'s `superRefine` step: each must be non-decreasing (`MINOR <= MODERATE <= SEVERE <= CRITICAL`), or `PerformanceRegression.compute`'s severity classification would silently skip or misorder a level.

## 7. Scope decisions

- **Scenarios are an in-code catalog, not DB-editable** — see §3's own reasoning, identical to Module 54's disaster-recovery plan catalog.
- **No queue/worker/scheduler** — load tests are synchronous, in-process, on-demand simulations, never long-running external processes; see §5.
- **Aggregated-only persistence.** `LoadTestRun`/`PerformanceBaseline` tables exist so evidence and comparison points outlive a single `npm run capacity-report` invocation, but never store raw per-request samples — only the same computed `LatencyStatistics`/throughput/resource-estimate figures a `LoadTestResult` already carries in memory. Every repository dependency is optional and every persistence call is non-fatal (see §5) — this remains a dev/CI-only engineering tool that must keep working without a configured database.
- **No DTOs layer** — this module's use cases take/return plain interfaces and domain aggregates directly, the same convention Module 54's use cases follow; this codebase does not have a project-wide `application/dto/` convention for every module.
- **No API route.** `GenerateCapacityReportUseCase` is fully wired and tested via `compose.ts` and driven by `npm run capacity-report`/`scripts/run-capacity-report.ts` — a CLI/CI-invoked tool has no need for an HTTP surface; the persisted `LoadTestRun`/`PerformanceBaseline` history is queryable directly (e.g. via Prisma Studio or a one-off script) rather than through a dedicated admin route, which this module does not need yet.

## 8. Testing

`tests/unit/core/domain/value-objects/latency-distribution.test.ts` and `tests/unit/core/domain/entities/{performance-scenario,load-test-result,performance-baseline,performance-regression,capacity-report}.test.ts` — value-object validation, aggregate lifecycle/state-machine coverage including illegal transitions, percentile computation edge cases (single sample, unsorted input, non-mutation), regression severity classification (including the zero-baseline division guard), and report score/production-readiness cut lines. `tests/unit/core/application/services/performance/**` — the load-testing orchestration's in-memory run/failure path, capacity extrapolation and threshold-based recommendations, bottleneck ranking/capping, and the additive readiness-score penalty model. `tests/unit/core/application/use-cases/performance/**` — scenario-catalog resolution; capacity-report assembly including "skip a scenario whose run fails", folding in a caller-supplied baseline's regression severity, persisting each scenario's aggregated result via a mocked `resultRepository` (and tolerating a rejected `save()` without failing the report), auto-capturing the first successful run as a scenario's baseline when none is stored, and auto-comparing against a stored baseline when none is supplied explicitly; and the baseline-comparison/regression-detection use cases' "resolve an explicit in-memory baseline/collection first, fall back to the repository, `null`/`NotFoundError` when nothing resolves either way" behaviour. `tests/unit/core/infrastructure/performance/**` — `mulberry32`/`BenchmarkRunner` determinism (same seed -> same samples, different seed -> different samples), per-category latency/resource differentiation, and the bounded sample-count ceiling. `tests/unit/core/infrastructure/database/prisma/repositories/{prisma-load-test-result-repository,prisma-performance-baseline-repository}.test.ts` — Prisma row <-> domain entity mapping in both directions with a mocked Prisma client, including the report-snapshot fields on `save()`, the "throws for a non-`COMPLETED` result" guard, and the `(scenarioId, label)` upsert key for baselines. `tests/integration/performance/compose-wiring.test.ts` — the real composition root end to end, including the real `PrismaLoadTestResultRepository`/`PrismaPerformanceBaselineRepository` (deliberately not mocked), proving every use case remains constructible and functional even though this sandbox has no reachable database — persistence failures are caught internally and never surface as a thrown error from `GenerateCapacityReportUseCase`.

## 9. Validation results

See the refactor's own validation run (typecheck, scoped and full test suites, lint, build, `prisma generate`/`prisma migrate status`, and an actual `npm run capacity-report` execution) for current pass/fail status. `prisma generate` has failed in every session in this sandbox so far (no network access to `binaries.prisma.sh` to fetch the Linux query-engine binary, including with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`) — the `@prisma/client` package's generated types therefore do not yet include `LoadTestRun`/`PerformanceBaseline`, which is expected to produce `tsc` errors at every call site that references those types (the two new Prisma repositories, and their unit tests) until `prisma generate` can run in an environment with the necessary network access. The code itself does not depend on that gap being closed to be correct — see this module's own repositories for the exact shape `prisma generate` needs to produce.
