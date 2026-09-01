# Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor

## 1. Problem confirmed from source code

Read `StartReconciliationRunUseCase`, `PrismaReconciliationDataSource`, the reconciliation
domain/repository ports, the Module 80/81/90/91 reports, the Prisma schema, and the cron/scheduling
infrastructure before writing any code. Confirmed, directly in source, exactly the audit's claim:

- `PrismaReconciliationDataSource.listJobIdsToInspect` ran:
  ```ts
  prisma.job.findMany({
    where: { quote: { payments: { some: {} } }, ...(since ? { updatedAt: { gte: since } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: options.limit,
  })
  ```
  i.e. "most-recently-active `limit` Jobs," `limit` defaulting to 500 (`RECONCILIATION_SCHEDULE_LIMIT`).
- Both automated entry points — the Vercel Cron route (`api/cron/reconciliation-run/route.ts`) and the
  in-process `JobScheduler` occurrence (`reconciliation-job-processor.ts` via `compose.ts`) — called
  `StartReconciliationRunUseCase.execute({ scope, limit }, null)` with `since: undefined`, every six
  hours, forever. Every invocation rescanned the *same* window of most-recently-active Jobs. A Job that
  falls out of the top 500 most-recently-active Jobs never gets automatically reconciled again.
- A **second, latent bug** was found while designing the fix, not assumed from the audit: the previous
  module's own doc comment on `ReconciliationDataSource.since` claimed it filters by "Jobs whose most
  recent relevant financial activity (Payment/Invoice/Payout/Refund/CreditNote `updatedAt`) is on/after
  this date." That is false. Grepping every write path that touches the `jobs` table
  (`PrismaJobRepository`'s own `updateMany` calls, the only place `prisma.job.update*` is called in this
  codebase) shows `Job.updatedAt` is bumped **only** by `Job`'s own status-transition methods
  (start/complete/cancel) — no Payment/Invoice/Payout/Refund/CreditNote write anywhere touches the Job
  row. So even the pre-existing `since` filter was not a reliable "financial activity happened" signal;
  a Job that already left the `updatedAt`-recency window but later gets a new refund would never
  re-enter the scan window by `since` either. This is corrected in the new code and documented at the
  point where it matters (`listJobIdsToInspectFromCursor`'s own doc comment).

## 2. Root cause

Two entry points, one engine, and the engine's own data-selection method was bounded but not
checkpointed: nothing durable ever recorded "how far has automated reconciliation gotten," so every
invocation re-derived the same window from `now()` and a fixed `limit`. There was no mechanism for
"already covered" Jobs to fall out of the window in a *controlled* way and for not-yet-covered Jobs to
enter it.

## 3. Chosen cursor strategy

A durable, advancing **keyset-pagination cursor over `(Job.createdAt, Job.id)`, ascending**, cycling
back to the start once it reaches the end.

- **`createdAt`**, not `updatedAt`: see §1 — `Job.updatedAt` does not reliably reflect financial
  activity, so it cannot be trusted as an ordering/filtering column for this purpose. `Job.createdAt` is
  immutable, assigned exactly once, at insert time, by the single Postgres server clock — the only
  column on this table guaranteed monotonically non-decreasing across every Job ever created.
- **`id` as tie-breaker**: `createdAt` alone is not unique (bulk seeding/backfills, high write
  throughput can produce same-millisecond rows). `id` (a UUID, globally unique) makes `(createdAt, id)`
  a total order with zero ties, so the keyset `>` predicate never has to guess which of two
  same-timestamp rows is "next."
- **Ascending, not descending**: the cursor must advance monotonically toward "the end of the eligible
  set," then wrap. Descending (most-recent-first, the old behavior) has no stable "end."

## 4. Why this cursor is safe (the seven required properties)

1. **Deterministic ordering** — `(createdAt, id)` ascending is a total order over every eligible Job; the
   same starting cursor position always yields the same next batch.
2. **No permanent starvation of old records** — the cursor cycles: once
   `listJobIdsToInspectFromCursor` returns fewer rows than `limit` (nothing left after the cursor), the
   *very next* successful batch resets the cursor to the start (`cycleNumber` incremented) rather than
   idling. Every eligible Job is swept again every full cycle, unconditionally — old Jobs are never
   excluded once "caught up."
3. **No accidental skipping on timestamp collisions** — the `id` tie-breaker (§3) makes every row
   individually addressable in the keyset predicate: `(createdAt > ?) OR (createdAt = ? AND id > ?)`.
   Proven in both a unit test (`FakeReconciliationDataSource`, synthetic same-timestamp seeding) and a
   real-Postgres test (`reconciliation-schedule-cursor.test.ts`, Scenario 8) with three Jobs sharing an
   identical `createdAt`.
4. **Bounded work per run** — one keyset query (`take: limit + 1`), one bounded reconciliation batch
   (`jobIds.length <= limit`), per invocation. Never a full-table scan, never unbounded memory.
5. **Safe restart after process failure** — see §6.
6. **Safe concurrent execution** — see §7.
7. **Compatibility with newly created/updated Jobs** — see §9.

## 5. Persistence mechanism

New Prisma model `ReconciliationScheduleCursor` (table `reconciliation_schedule_cursors`), one row per
named cursor key (`"scheduled-job-ledger"` is the only key in use today — the column exists so a future
independently-scheduled sweep never has to share this row or migrate the schema again). Fields:
`lastCreatedAt`/`lastJobId` (the checkpoint position, null = start of a cycle), `cycleNumber`/
`cycleStartedAt` (observability), `version` (optimistic-concurrency token), `lastAdvancedAt`.

`PrismaReconciliationRunRepository`/`ReconciliationRun` was inspected first and rejected as the
checkpoint's home: a `ReconciliationRun` row is an append-only *historical record of one execution*, not
a mutable pointer, and using its `startedAt`/`recordsInspected` as a de-facto cursor would require
scanning run history to reconstruct position on every invocation — the smallest correct model is a
single dedicated mutable row, which is what was added.

Two methods only: `getOrCreate` (idempotent bootstrap via Prisma `upsert` on the unique `cursorKey`) and
`advance` (the only mutation — see §6/§7).

## 6. Failure semantics

`RunScheduledReconciliationSweepUseCase.execute()` follows exactly the five-step sequence the spec
requires:

1. **Read** the cursor (`cursorRepo.getOrCreate`).
2. **Select** one bounded batch strictly after it (`dataSource.listJobIdsToInspectFromCursor`).
3. **Reconcile** the batch (`StartReconciliationRunUseCase.execute` with the new `jobIds` engine input —
   see §10).
4. **Only if** that run's status is not `FAILED`, **persist** the new cursor position
   (`cursorRepo.advance`), pointing at the last Job in the batch just reconciled.
5. If the run **failed**, the cursor is left exactly where it was — the next invocation reads the same,
   unmoved cursor and selects the identical batch again.

This is correct even though the engine processes Jobs one at a time internally: a run that fails partway
through its batch still reports `status: "FAILED"` for the run *as a whole*
(`StartReconciliationRunUseCase`'s own `catch` block, unmodified by this module), so the cursor is never
advanced for a partially-completed batch. Retrying a batch is always safe — reconciliation performs no
financial writes, and every discrepancy it (re-)detects is deduplicated by
`ReconciliationDiscrepancyRepository.createOrTouch`'s fingerprint + partial unique index (Module 80/91's
existing invariant, unchanged and re-verified: see §11).

Proven in a fake-based unit test (kill `runs.complete()` once, verify the cursor doesn't move, retry,
verify the identical batch is re-selected and the cursor then advances) and a real-Postgres test with
the same shape (Scenario 3/4).

## 7. Concurrency semantics

The entire read-batch-reconcile-persist sequence runs inside `DistributedLock.withLock(...)` — the
existing Module 44 primitive (`RedisLockService`/`InMemoryLockService`, via the existing
`createDistributedLock()` factory `payments/compose.ts` already uses for
`ExecuteProfessionalPayoutUseCase`). No second locking mechanism was introduced. A losing concurrent
invocation returns immediately with `outcome: "skipped_locked"` — never blocks, never retries, never
partially advances.

Belt-and-suspenders beneath the lock: `advance()` is an optimistic-concurrency conditional
`UPDATE ... WHERE "cursorKey" = ? AND "version" = ?` (via Prisma `updateMany`, checking `count === 1`).
Even if two processes somehow used two non-coordinating lock backends, at most one could ever
successfully advance the cursor for a given prior state — the loser's `advance()` returns `null`
(never throws, never silently overwrites) and is logged (`reconciliation.scheduled_sweep_cursor_race`,
`warn`).

Proven with a **real concurrent test**: two independently-constructed `RunScheduledReconciliationSweepUseCase`
instances sharing one `InMemoryLockService`, invoked via `Promise.all` against the real database —
exactly one outcome is `"completed"`, the other `"skipped_locked"`, and the persisted cursor's `version`
advances by exactly 1, not 2 (Scenario 9). A second test forces the optimistic-concurrency path directly
by racing `advance()` calls with a stale `expectedVersion` (Scenario 10 / restart safety).

## 8. Full-cycle semantics

When a batch's `cycleCompleted` flag is true (the keyset query found no more eligible Jobs after it —
detected via a `limit + 1` over-fetch, no second round-trip needed) **and** that batch's run succeeds,
the cursor resets to `null`/`null` and `cycleNumber` increments in the *same* `advance()` call — there is
no separate "detect the end" invocation required. The very next scheduled invocation starts a fresh pass
from the first eligible Job again. The sweep continuously, repeatedly covers the entire ledger — it does
not scan once and go idle.

## 9. New-record semantics

`Job.createdAt` is immutable and monotonically non-decreasing (assigned once, by the database server
clock, at insert time — see §3). Therefore **any newly-created Job is necessarily ordered after wherever
the cursor currently sits** and is swept within the *current* cycle, not merely "eventually, after a
wraparound." This is a stronger guarantee than the spec's minimum bar and is proven directly (Scenario
7: seed 3 Jobs, sweep 2, insert a 4th Job with a far-future `createdAt`, sweep again, confirm both the
remaining original Job and the new one are included in the very next batch).

A Job whose *related* financial rows change after the sweep has already passed its position (e.g. a
refund posted against an old Job) is **not** re-swept immediately — it is re-swept at the next full
cycle, since every cycle unconditionally re-inspects every eligible Job regardless of whether anything
about it changed. See §16, "Known limitations," for the latency this implies and its mitigation.

## 10. Database changes

Migration `prisma/migrations/20260911000000_add_reconciliation_schedule_cursor/migration.sql`:

- `CREATE INDEX "jobs_createdAt_id_idx" ON "jobs" ("createdAt", "id")` — non-concurrent (Prisma wraps
  migrations in a transaction; `CREATE INDEX CONCURRENTLY` cannot run inside one — see the migration's
  own comment for the documented trade-off and the concurrent-index follow-up this implies for a very
  large production `jobs` table).
- `CREATE TABLE "reconciliation_schedule_cursors" (...)` + its unique index on `cursorKey`.

Both are additive-only. No existing table, column, constraint, or row is altered, dropped, or
backfilled. No destructive statement anywhere in the migration.

Application-layer change (not a schema change): `StartReconciliationRunUseCase.execute()`'s input type
widened to `StartReconciliationRunEngineInput extends StartReconciliationRunInput { jobIds?: string[] }`
— an additive, backward-compatible, internal-only field. When `jobIds` is provided, the engine
reconciles exactly that list instead of calling `dataSource.listJobIdsToInspect(since, limit)`. This is
how the new scheduled-sweep use case drives the one, unchanged reconciliation engine over a
cursor-selected batch without a second engine or duplicated discrepancy logic. `jobIds` is never
accepted by `startReconciliationRunSchema` (the Zod schema at the admin Server Action boundary) — an
admin-triggered manual run can never pass it; it originates only from
`RunScheduledReconciliationSweepUseCase`, entirely inside the application layer.

## 11. Tests added

- `tests/unit/core/application/use-cases/reconciliation/run-scheduled-reconciliation-sweep.use-case.test.ts`
  — 10 fake-based tests covering every numbered scenario in the spec (first run, advancement, failure,
  retry, multiple batches, full cycle, empty ledger, new records, timestamp collisions, concurrent
  execution via a shared `FakeDistributedLock`, cursor-race detection).
- `tests/unit/core/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source-cursor.test.ts`
  — mocked-Prisma unit coverage of the new query's construction: the keyset `OR` predicate, the
  `limit + 1` over-fetch/trim, and the `cycleCompleted` boundary.
- Extended `start-reconciliation-run.use-case.test.ts` with three tests for the new `jobIds` engine
  input (exact-batch reconciliation, legitimate empty batch, and that omitting it preserves the
  pre-existing `since`/`limit` behavior byte-for-byte).
- Updated `fakes.ts` with `FakeReconciliationScheduleCursorRepository`, `FakeDistributedLock`, and
  extended `FakeReconciliationDataSource` with `listJobIdsToInspectFromCursor` (mirroring the real
  keyset semantics, including a `createdAt` override for collision testing).
- Rewrote `reconciliation-job-processor.test.ts` for the processor's new dependency
  (`RunScheduledReconciliationSweepUseCase` instead of `StartReconciliationRunUseCase` directly),
  covering all four outcomes (`completed`, `skipped_locked`, `skipped_empty`, `run_failed`).
- Extended `reconciliation-run-route.test.ts` for the cron route's new wiring and the two new
  non-failure outcomes (`skipped_locked`, `skipped_empty` both return 200, not 500).
- Existing fake-based unit test suites (Module 80/81/90's own — `resolve-discrepancy`,
  `get-reconciliation-overview`, `list-reconciliation-runs`, `alert-on-critical-discrepancy`, etc.) were
  **not** rewritten — only the two files whose behavior genuinely changed
  (`start-reconciliation-run.use-case.test.ts`, `reconciliation-job-processor.test.ts`,
  `reconciliation-run-route.test.ts`) were touched.

## 12. Real PostgreSQL tests

`tests/integration-db/financial/reconciliation-schedule-cursor.test.ts`, using the Module 91 harness
(`setupDbTestLifecycle`, real `PrismaReconciliationDataSource`/`PrismaReconciliationScheduleCursorRepository`/
`PrismaReconciliationRunRepository`/`PrismaReconciliationDiscrepancyRepository`, a real
`InMemoryLockService`, real Job/Quote/Payment rows via the extended `createFinancialGraph`/`createJob`
seed helpers with a controllable `createdAt`). Covers all ten spec scenarios:

1. first scheduled run, 2. cursor advancement to the exact end of the batch, 3–4. failure + retry
(forced by an injected `ReconciliationRunRepository.complete()` that throws once), 5. three sequential
batches covering ten Jobs with zero overlap/gap, 6. full-cycle reset + fresh pass, 7. a Job created after
the cursor advanced is included in the very next batch, 8. three Jobs sharing one `createdAt` are all
covered with a deterministic id tie-break, 9. two *real* concurrent `Promise.all` invocations sharing one
lock — exactly one completes, cursor `version` advances by exactly 1, 10. a direct optimistic-concurrency
race on `advance()` is detected and returns `null` without corrupting state, and the system remains
usable afterward.

`reset-database.ts`'s `TABLES_TO_RESET` list was extended with `reconciliation_schedule_cursors` so this
new table is truncated between tests like every other Module 91 table.

## 13. Performance considerations

- Every scheduled invocation issues exactly one keyset query (`take: limit + 1`, backed by the new
  `jobs_createdAt_id_idx` composite index) — no full-table scan, no unbounded result set, no N+1 (the
  same `getJobFinancialContext` per-Job fan-out `StartReconciliationRunUseCase` already used is
  unchanged).
- `RECONCILIATION_SCHEDULE_LIMIT`'s existing bound (1–2000, default 500) still caps a single
  invocation's cost exactly as before — its *meaning* changed (batch size within an advancing sweep, not
  "most recent N"), not its bound.
- The `limit + 1` over-fetch (to detect `cycleCompleted` without a second round-trip) is a single extra
  row per query — negligible.

## 14. Configuration changes

No new environment variable was introduced — `RECONCILIATION_AUTOMATION_ENABLED`,
`RECONCILIATION_SCHEDULE_CRON`, and `RECONCILIATION_SCHEDULE_SCOPE` are unchanged in both meaning and
default. `RECONCILIATION_SCHEDULE_LIMIT` keeps its existing name, type, default (500), and range
(1–2000) — only its *documented meaning* changed (now "batch size per sweep invocation," not "how many
of the most-recently-active Jobs to rescan"), and `env.ts`'s own comment was rewritten in place to say
so, including a safe-range/production-recommendation note (200–1000; size against your own eligible-Job
growth rate so a full cycle completes in an operationally acceptable number of days).

## 15. Operational considerations

- **Cycle-time sizing**: at the default `limit=500` and the default 6-hour cron cadence, one full cycle
  over N eligible Jobs takes roughly `ceil(N / 500) * 6` hours. An operator with a fast-growing ledger
  should raise `RECONCILIATION_SCHEDULE_LIMIT` and/or shorten `RECONCILIATION_SCHEDULE_CRON` to keep
  cycle time operationally acceptable — this is a tuning knob, not a code change.
- **Observability**: every sweep outcome is logged via new structured events in
  `reconciliation-observability.ts` (`reconciliation.scheduled_sweep_advanced` /
  `_skipped_locked` / `_skipped_empty` / `_batch_failed` / `_cursor_race`), each carrying
  `cursorBefore`/`cursorAfter`/`cycleNumber`/`recordsSelected` — an operator can answer "where is the
  sweep, and is it moving" from logs alone, without a new dashboard. The cron route's own JSON response
  also now surfaces `outcome`/`cursor.before`/`cursor.after`/`cycleNumber`/`cycleCompleted`.
- No new health endpoint was added — deliberately, to avoid unnecessary scope expansion (the spec
  explicitly says "do not expand scope unnecessarily"; the structured logs above already materially
  improve diagnosability). Exposing `ReconciliationScheduleCursor` state on the existing admin
  reconciliation overview is a natural, small follow-up left to a future module if an operator wants it
  in the UI rather than logs.

## 16. Known limitations

- **Latency for financial changes to already-passed Jobs**: a refund/payout/invoice change on a Job the
  sweep already passed in the current cycle is not re-inspected until the *next* full cycle (see §9). At
  the default configuration this can be several days for a large ledger. Mitigation: the existing,
  unmodified admin-triggered manual run (`since`-scoped) remains available for an operator who needs
  faster coverage of a specific recent change; the "Recommended next module" below proposes closing this
  gap properly.
- **`CREATE INDEX` is non-concurrent** in this migration (see §10) — acceptable for the current table
  size, but a very large production `jobs` table should consider a follow-up
  `CREATE INDEX CONCURRENTLY` migration (which Prisma can only express as a second, non-transactional
  migration step) before/instead of this one if lock contention during deployment is a concern.
- **Verification environment constraints**: this environment's `device_bash` shell (and the cloud
  container used for research) both had no network route to `binaries.prisma.sh`, so `npx prisma
  generate`/`validate` could not be run here — see §17 for exactly what was and was not verified as a
  result, and what still needs to run before merge.
- A stale, empty `.git/index.lock` was found in the working tree at the start of this session (visible
  as a failed-unlink warning on an early `git status` call) and could not be removed — device delete
  permission for this action was declined. It appears not to block read-only git commands (`git status`/
  `git diff` succeeded normally afterward) but will block `git add`/`git commit` with a
  "`fatal: Unable to create '.git/index.lock': File exists`" error until manually deleted
  (`rm .git/index.lock` from the repo root) before staging/committing this module's changes.

## 17. Validation results

- **`npx tsc --noEmit`**: clean except for 10 errors, all of the identical shape
  (`Property 'reconciliationScheduleCursor' does not exist on type 'PrismaClient<...>'`), in exactly the
  3 files that reference the new model (`prisma-reconciliation-schedule-cursor-repository.ts`,
  `reconciliation-schedule-cursor.test.ts`). This is the expected, environment-only consequence of not
  being able to run `npx prisma generate` after the schema change (no network route to
  `binaries.prisma.sh` from this environment — confirmed via direct `curl`, 403 from an allowlist, in
  both the local-device shell and the research/verification container). **Every other file in the
  diff — including every file that does not touch the new table — typechecks cleanly.** Running
  `npx prisma generate && npx tsc --noEmit` locally/in CI (which has real network access) is expected to
  show zero errors; this was not fabricated as "passing" without that caveat.
- **`npx eslint`** on every new/changed file: zero errors, zero warnings (two warnings were surfaced and
  fixed in place — an `import type` consistency warning and an unused import).
- **Targeted `npx vitest run`** (all fake-based unit tests under
  `tests/unit/core/application/use-cases/reconciliation/`,
  `tests/unit/core/infrastructure/reconciliation/`, the new cursor-query unit test, the cron route test,
  the admin reconciliation Server Action/presentation tests, and the multi-instance-safety checker
  suite): **108/108 passed**, 18/18 files, zero failures, zero regressions.
- **`npm run test:integration:db`**: **not run** in this environment — no reachable PostgreSQL instance
  and no way to regenerate a matching Prisma query engine here (same network constraint as above). The
  new `reconciliation-schedule-cursor.test.ts` was written to the same conventions as the existing,
  passing Module 91 real-DB suite and reviewed carefully by hand, but it has not actually been executed
  against a real database in this session — this is stated plainly rather than claimed as passing.
  **Before merge, run `npx prisma generate && npx prisma migrate deploy && npm run test:integration:db`**
  against a real PostgreSQL instance to confirm.
- **Full `npm run test:unit`** (the entire suite, not just the reconciliation-adjacent subset): not
  completed — each vitest invocation in this environment carries a large fixed startup cost (~100s+)
  independent of test count, and a full-suite run exceeded the available single-command time budget
  here. The targeted run above exercises every file this module touches or could plausibly regress
  (reconciliation, the cron route, the multi-instance-safety cron/scheduler checkers, admin
  reconciliation) with zero failures. Running the full `npm run test:unit` locally/in CI is the
  remaining step to catch any regression entirely outside that surface (none is expected — `env.ts` and
  `seed-helpers.ts` changes are additive/comment-only and backward-compatible).
- **Production build**: not attempted — same network/engine constraint would apply to `next build`'s own
  Prisma client generation step.

## 18. Recommended next module

Close the "latency for financial changes to already-passed Jobs" gap (§16) properly: subscribe to the
existing Payment/Refund/Payout/Invoice/CreditNote domain events and enqueue a targeted, single-Job
reconciliation check independent of the cursor sweep, so a financial change on an old Job is caught
same-day rather than waiting for the next full cycle. This is deliberately left out of Module 92's scope
— the spec's core requirement (guaranteed eventual full-ledger coverage, bounded, durable, concurrency-
safe) does not require it, and adding it here would have expanded scope beyond what was asked.
