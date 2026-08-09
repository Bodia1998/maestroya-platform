# Module 54 — Backup & Disaster Recovery

## 1. What this module is

A production-grade backup and disaster-recovery layer for the platform's
two stateful systems — the PostgreSQL database and the Cloudinary-hosted
file storage (Module 18) — built entirely as Clean Architecture
abstractions, so the concrete backend behind either can change without
touching a single line of business logic.

Four concrete capabilities:

1. **Backup strategy** — full/incremental planning, a swappable
   `DatabaseBackupProvider`/`StorageBackupProvider` pair, retention
   policies with a floor on how many backups are always kept, and
   scheduled backups built on Module 45's existing job runtime.
2. **Restore support** — a restore workflow with lifecycle validation,
   an immediately-before-restore integrity re-check, and backup
   artifact/integrity checking independent of restore.
3. **Disaster recovery** — a code-defined plan catalog (runbooks), a
   step-by-step execution engine that records checkpoints, and a
   readiness service that reports whether every plan's RPO is currently
   met and whether it has been drilled recently enough to trust.
4. **Health & monitoring** — two new checks (`checks.backup`,
   `checks.disasterRecovery`) joining `/api/health/ready`'s existing
   "operational visibility only" category, plus a status-reporting read
   path that never throws.

`BACKUP_ENABLED` (default `false`) is the module's single kill switch —
see §7.

## 2. Architecture

```
domain/entities/
  backup.ts                          — BackupRecord (state-machine
                                        aggregate), RetentionPolicy
  disaster-recovery.ts                — DisasterRecoveryPlan,
                                        RecoveryExecution (state-machine
                                        aggregate), RecoveryCheckpoint
domain/repositories/
  backup-record-repository.ts
  recovery-execution-repository.ts
domain/errors/domain-error.ts        — InvalidBackupTransitionError,
                                        BackupValidationError,
                                        RestoreValidationError,
                                        IntegrityCheckError,
                                        RecoveryPlanNotFoundError,
                                        InvalidRecoveryTransitionError

application/ports/
  database-backup-provider.ts        — DatabaseBackupProvider
  storage-backup-provider.ts         — StorageBackupProvider
application/services/backup/
  backup-planning-service.ts         — FULL vs INCREMENTAL decision
  retention-policy-service.ts        — which backups are now expired
  backup-validation-service.ts       — artifact self-consistency
  integrity-check-service.ts         — checksum re-verification
application/services/recovery/
  disaster-recovery-plans.ts         — the plan catalog (code, not a table)
  disaster-recovery-service.ts       — step-by-step execution engine
  restore-validation-service.ts      — is this record a valid restore target
  recovery-readiness-service.ts      — RPO/drill-freshness evaluation
application/use-cases/backup/
  create-backup.use-case.ts
  apply-retention-policy.use-case.ts
  get-backup-status.use-case.ts
application/use-cases/recovery/
  restore-backup.use-case.ts
  run-disaster-recovery.use-case.ts
  get-recovery-readiness.use-case.ts

infrastructure/backup/
  backup-config.ts                   — resolveBackupConfig() from env
  pg-dump-database-backup-provider.ts — default DatabaseBackupProvider
  cloudinary-manifest-storage-backup-provider.ts — default StorageBackupProvider
  backup-jobs.ts, backup-job-processor.ts — Module 45 job vocabulary
  backup-health.ts, recovery-health.ts    — collect*Health()
  compose.ts                         — composition root
infrastructure/database/prisma/repositories/
  prisma-backup-record-repository.ts
  prisma-recovery-execution-repository.ts

prisma/schema.prisma                 — BackupRecord, RecoveryExecution
app/api/health/ready/route.ts        — checks.backup, checks.disasterRecovery
instrumentation.ts                   — registerScheduledBackups()
```

This mirrors Module 50's shape most closely: repositories, a pair of
swappable providers (≈ `SmsSender`), pure application services, a queue +
worker on Module 45's runtime, a scheduled trigger, and two health reports
consumed by the same route every other module's checks live in. No DI
container; every dependency is wired by hand in `compose.ts`, the same
convention every prior module follows.

## 3. Backup strategy

### Database backups

`PgDumpDatabaseBackupProvider` shells out to PostgreSQL's own
`pg_dump`/`pg_restore` in the compressed custom (`-Fc`) archive format.
The connection string is never passed as a CLI argument (visible to every
process on the host via `ps`); it is parsed once into the standard
`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGSSLMODE`
environment variables both tools already read, scoped to the spawned
child process. Every error message is passed through a redaction step
that strips any literal occurrence of the connection string before it can
reach a log line or a `BackupRecord.failureReason`.

A managed-Postgres-provider snapshot API (RDS, Cloud SQL, Neon, Supabase's
own point-in-time recovery) is a complete, equally valid alternative
implementation of the same `DatabaseBackupProvider` interface — this
module's default provider targets the self-hosted/`docker-compose.prod.yml`
topology specifically, per that file's own comment on Postgres deployment
options.

### File/storage backup strategy

`CloudinaryManifestStorageBackupProvider` captures a signed, checksummed
JSON **manifest** of every resource under the platform's Cloudinary
account (via the Admin API's `resources` listing), not a re-downloaded
copy of the binaries themselves. Cloudinary already is a durable,
replicated third-party store for every uploaded image/document
(Module 18) — re-storing the bytes here would duplicate protection
Cloudinary already provides, at real cost, against a failure mode this
platform cannot independently detect or recover from differently anyway.
What this platform *can* lose independently of Cloudinary — its own
record of which resources exist, under which ids — is exactly what the
manifest captures and restores.

### Backup metadata

Every backup run is a `BackupRecord` aggregate: target
(`DATABASE`/`FILE_STORAGE`), type (`FULL`/`INCREMENTAL`), a status state
machine (`PENDING → RUNNING → COMPLETED → VERIFIED`, with `FAILED`/
`RESTORED`/`EXPIRED` reachable from the appropriate states), size,
checksum, location, and timestamps for every transition. Persisted via
`PrismaBackupRecordRepository` to the `backup_records` table — see
`prisma/schema.prisma`'s own comment for why `sizeBytes` is `BigInt`
(a full dump can exceed `Int`'s ~2GB ceiling).

### Retention policies

`RetentionPolicy(retentionDays, minRetainedBackups)` is denormalized onto
each `BackupRecord` at schedule time — a later policy change can never
retroactively alter what an already-completed backup's own expiry means.
`RetentionPolicyService.selectExpired` returns every successful backup
past its own `expiresAt`, **except** the target's newest
`minRetainedBackups` — a floor that guarantees a target with no recent
successful backup can never lose its last good recovery point to a cron
sweep just because it aged out. `ApplyRetentionPolicyUseCase` deletes each
expired backup's underlying artifact (best-effort; a deletion failure is
reported, not fatal) and always marks the `BackupRecord` `EXPIRED`
regardless — the record's status, not the artifact's actual on-disk
presence, is what `RestoreValidationService` trusts.

### Incremental vs full backup support

The domain model fully supports both: `BackupPlanningService` decides
`FULL` when there is no prior successful backup, the latest is older than
`BACKUP_FULL_INTERVAL_DAYS`, or the latest is itself an `INCREMENTAL`
(a chain is never more than one incremental deep — restoring one always
means "apply this incremental on top of the one full backup immediately
before it," a fixed two-step restore, never an unbounded replay).

The *default* `PgDumpDatabaseBackupProvider`, however, performs an
identical full logical dump for both types — `pg_dump` has no logical-
dump equivalent of a true incremental backup; that requires WAL-based
continuous archiving, a materially different mechanism/provider. This is
a real, fully restorable backup either way, never a placeholder; the
`INCREMENTAL` distinction simply has no effect on *this* provider's work
today. A WAL-archiving provider implementing the same
`DatabaseBackupProvider` interface is the natural upgrade path, requiring
no change above the provider boundary.

### Scheduled backup abstractions

`registerScheduledBackups()` (called from `instrumentation.ts`,
immediately before `startBackgroundJobs()`, mirroring Module 50's own
`registerScheduledAnalyticsRefresh()`) registers one cron schedule per
target against the shared `JobScheduler` (`BACKUP_SCHEDULE_CRON`, default
`0 2 * * *` UTC). A single job type (`backup.run`) both creates the
backup and applies retention for the same target immediately afterward —
coupling them keeps the schedule to one cron entry per target and
guarantees retention can never be silently skipped by a scheduler hiccup
dropping one of two independently-scheduled jobs. `triggerManualBackup()`
enqueues the identical job on demand.

## 4. Restore support

`RestoreBackupUseCase` runs, strictly in order: lookup → lifecycle/target
validation (`RestoreValidationService` — status must be `COMPLETED`/
`VERIFIED`, not expired, target must match) → **integrity re-verification
immediately before restoring** (a backup verified an hour or a month ago
is not guaranteed to still be intact; checking again right before restore
is the only point that actually matters) → the provider's restore call →
`markRestored`. A restore is never retried automatically — restoring the
wrong data twice is worse than restoring it once and failing loudly the
second time.

`IntegrityCheckService` is deliberately independent of restore — it is
also the mechanism `DisasterRecoveryService`'s `verify-latest-backup-
integrity` step and any future standalone "verify all my backups" sweep
would use, without needing to restore anything.

## 5. Disaster recovery

Plans (`DisasterRecoveryPlan`) are a **code-defined catalog**
(`disaster-recovery-plans.ts`), not a database table — a recovery runbook
is a reviewed, deployed engineering artifact exactly as load-bearing as
code, the same reasoning `RateLimitPolicy`'s fixed policy set and Module
36's `TaxCalculator` registry already establish in this codebase. Two
plans ship today: `database-outage-recovery` and `storage-outage-
recovery`, each a four-step runbook (verify → restore → verify
recovery → notify stakeholders), the first three automated and the last
requiring a human.

`DisasterRecoveryService.execute()` runs a plan's steps strictly in
order, recording a `RecoveryCheckpoint` for every one. An automated step
that throws (or has no registered handler) fails the checkpoint and the
whole execution immediately, without attempting later steps — an
unrecoverable automated step means the runbook cannot safely continue. A
non-automated step is recorded `SKIPPED`, and execution continues — "the
automation's part is done, a human must finish the rest" is a successful
automated run, not a failure. `RunDisasterRecoveryUseCase` wires the
three automated steps to this module's own `RestoreBackupUseCase`/
`GetBackupStatusUseCase`/`IntegrityCheckService` — the exact same code
path both a real incident and a scheduled drill exercise, so a drill
proves what a real recovery would actually do.

`RecoveryReadinessService` answers "could we recover right now if we had
to," purely from already-fetched facts: `not_ready` when a plan's RPO
could not currently be met (no completed backup yet, or the freshest one
already exceeds `rpoMinutes`); `at_risk` when every RPO is satisfied but a
plan has not been successfully drilled within `MAX_DRILL_AGE_DAYS` (90);
`ready` otherwise.

## 6. Health & monitoring

`checks.backup` and `checks.disasterRecovery` join `/api/health/ready`'s
existing "operational visibility only" category, for the identical
reasoning `checks.searchEngine`/`checks.analytics` already establish: a
stale/failed backup or an at-risk recovery plan describes a *hypothetical*
future incident's recoverability, never this instance's present ability
to serve HTTP traffic — never a 503. Both report `"disabled"` when
`BACKUP_ENABLED` is not `"true"` (the default), a normal, healthy state
for a deployment whose managed Postgres provider already runs its own
snapshots.

`GetBackupStatusUseCase`/`GetRecoveryReadinessUseCase` are the same read
paths an admin surface would build a dashboard on — both are pure reads,
never throwing, and both work identically whether or not the backup
pipeline is enabled (a disabled pipeline just reports "no backups yet"
honestly, the same way Module 50's dashboard reads still work with its
own refresh pipeline off).

## 7. Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_ENABLED` | `false` | Master switch — `false` runs zero backup/recovery machinery. |
| `BACKUP_STORAGE_DIR` | `/var/backups/maestroya` | Where dump/manifest artifacts are written. |
| `BACKUP_RETENTION_DAYS` | `30` | Days a backup remains a valid restore candidate. |
| `BACKUP_MIN_RETAINED_BACKUPS` | `3` | Floor on successful backups always kept per target. |
| `BACKUP_FULL_INTERVAL_DAYS` | `7` | How often a `FULL` backup is required. |
| `BACKUP_SCHEDULE_CRON` | `0 2 * * *` | Scheduled backup cadence (UTC, 5-field cron). |

## 8. Architectural decisions

- **No business logic inside infrastructure.** Every provider
  (`PgDumpDatabaseBackupProvider`, `CloudinaryManifestStorageBackupProvider`,
  the two Prisma repositories) does mechanical I/O only — planning,
  retention, validation, and integrity *decisions* live entirely in
  `application/services/`, unit-tested with hand-built fakes and zero I/O.
- **Fail safely.** `CreateBackupUseCase` persists a `PENDING` record
  before calling any provider and transitions to `RUNNING` before the
  actual call, so a crash mid-backup leaves an accurate, inspectable
  record rather than nothing. Every failure path (`markFailed`) is
  reachable from every state a backup could be interrupted in.
  `DisasterRecoveryService` either completes or explicitly fails an
  execution on every code path — never leaves one stuck `IN_PROGRESS`.
- **Never expose sensitive information.** Connection strings are never
  logged, passed as CLI args, or embedded in a thrown error message
  (`redact()` in `pg-dump-database-backup-provider.ts`). `BackupRecord`
  carries a `locationUri` (a path/manifest reference) and a
  `failureReason` (a redacted diagnostic string) — never a credential.
- **Providers are replaceable.** `DatabaseBackupProvider`/
  `StorageBackupProvider` are the only two seams application code depends
  on; every concrete class behind them is swappable without touching a
  service, use case, or the domain model.
- **Reuses existing infrastructure.** The job scheduler, queue, worker,
  dead-letter queue, and job-idempotency store are all Module 45's; the
  Cloudinary client is Module 18's; the health-report shape and
  `/api/health/ready` wiring follow every prior module's own convention
  exactly.

## 9. Testing

`tests/unit/core/domain/entities/{backup,disaster-recovery}.test.ts` —
aggregate lifecycle/state-machine coverage, including illegal
transitions. `tests/unit/core/application/services/**` — retention
selection (including the `minRetainedBackups` floor and "never re-expire
an already-EXPIRED backup"), planning decisions, artifact validation
(malformed checksum, zero size, empty location), integrity-check
delegation and failure translation, restore validation, the disaster-
recovery execution engine (automated success, automated failure halting
later steps, missing handler, checkpoint persistence), and readiness
evaluation (`not_ready`/`at_risk`/`ready` transitions).
`tests/unit/core/application/use-cases/**` — full happy-path and failure-
path coverage for create/restore/apply-retention/run-recovery, each
asserting the record/execution ends in the correct terminal state.
`tests/unit/core/infrastructure/backup/**` — the two health-report
collectors. `tests/unit/core/infrastructure/database/prisma/repositories/
prisma-backup-record-repository.test.ts` — Prisma row ↔ aggregate
mapping, including the `BigInt`↔`number` conversion. `tests/integration/
backup/backup-health-route-wiring.test.ts` — proves the real composition
root surfaces both checks on `/api/health/ready` with the pipeline
disabled (this codebase's normal default state).

## 10. Validation results

Prisma engine binaries for this sandbox's platform could not be fetched
(network-restricted — the same confirmed limitation every prior module's
"Validation Results" section already documents, see
`docs/MODULE_21_DISPUTES_SUPPORT.md`), so the migration in this module was
hand-authored rather than generated by `prisma migrate dev` against a live
diff; `npx prisma generate`/`npx prisma migrate status` results were
recorded as run in this environment. See the delivery summary for the
exact command output.
