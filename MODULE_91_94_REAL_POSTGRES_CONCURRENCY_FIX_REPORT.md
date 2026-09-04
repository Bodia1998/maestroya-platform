# Module 91/94 — Real PostgreSQL Concurrency Fixes

Fixes for the final 2 real-Postgres integration failures reported after
the previous fix round (69/71 passing, 2 genuine concurrency bugs). No
secrets in this file. No git add/commit/push, no branch change, no
migrations added/renamed, no unique constraint weakened, no assertion
loosened, no in-memory/application-level mutex used.

## Failure A — `payment-uniqueness.test.ts` ("concurrent duplicate Payment creation")

### Root cause

`PrismaPaymentRepository.create()` used `prisma.payment.upsert({ where:
{ stripePaymentIntentId }, create, update: {} })`, whose own doc comment
already correctly stated the intended contract ("if a row for this
`stripePaymentIntentId` already exists ... return that existing row
untouched"). But `upsert()` alone is not a sufficient guard against a
GENUINELY concurrent duplicate create: two callers racing to create the
first row for the same not-yet-existing `stripePaymentIntentId` can both
reach `upsert`'s internal "no existing row" branch before either
commits, and the loser gets an unhandled Prisma P2002 instead of
transparently converging on the winner's row — this is the identical
shape of bug already fixed in the prior round for
`PrismaReconciliationScheduleCursorRepository.getOrCreate()`, now found
in a second repository under a real 5-way concurrent
`Promise.all(repository.create(...))` run.

The existing test file already had adequate coverage for exactly this
race — `"concurrent duplicate Payment creation via the real repository
never produces two rows"` (5 concurrent `repository.create()` calls,
asserting exactly one distinct id and exactly one DB row) — so no new
test was needed; that existing test is what caught this.

### Fix

`prisma-payment-repository.ts`, `create()`: wrapped the `upsert()` call
in try/catch. On `Prisma.PrismaClientKnownRequestError` with `code ===
"P2002"`, re-read the row via the repository's own
`findByStripePaymentIntentId(data.stripePaymentIntentId)` and return it;
any other error, or a P2002 with no row found on re-read (should be
unreachable — a P2002 on this exact constraint means some row committed),
is rethrown, never swallowed. This is the exact same pattern already
established in `PrismaAffiliateCommissionReversalRepository.create` and
`PrismaReconciliationScheduleCursorRepository.getOrCreate` — no new
pattern introduced, matching the existing architecture.

## Failure B — `gdpr-cloudinary-purge-retry.test.ts` ("concurrency: two overlapping claims")

### Root cause

`PrismaProfessionalVerificationRepository.claimPendingStoragePurgeBatch()`
was already a single atomic SQL statement (`WITH claimed AS (SELECT ...
FOR UPDATE SKIP LOCKED) UPDATE ... FROM claimed ... RETURNING`) — correct
as far as it goes, but `FOR UPDATE SKIP LOCKED` row locks are held only
for the duration of THAT statement's own implicit transaction, i.e. only
for the single round trip that does the claiming. They say nothing about
the time between that statement committing and the caller actually
processing each claimed document (calling Cloudinary, then
`recordDocumentStoragePurgeFailure`/`markDocumentStoragePurged` —
`RetryPendingCloudinaryPurgesUseCase.runBatch`'s per-document loop, which
runs entirely AFTER the claim statement has already returned and
released its locks).

The claim statement set `storagePurgeLastAttemptedAt` on the claimed
rows, and that column's own doc comment already claimed it "doubles as
the atomic claim's already-being-worked signal alongside
`storagePurgeNextAttemptAt`" — but the claim query's `WHERE` clause never
actually checked it. Nothing durable marked a just-claimed row as
ineligible for a second claim until its real outcome was recorded. A
second claim landing in that gap — whether genuinely concurrent or
simply running moments after the first claim statement already committed
— still saw `storagePurgeStatus = 'PENDING'` and an unchanged
(already-due) `storagePurgeNextAttemptAt`, and claimed the same rows
again. A real concurrent run of exactly this scenario (two
`claimPendingStoragePurgeBatch` calls via `Promise.all`, 8 due documents)
reproduced a full double-claim (overlap of 8).

### Fix

Added a short claim lease, using the field the design already intended
for this: the same atomic claim `UPDATE` now ALSO advances
`storagePurgeNextAttemptAt` forward by `STORAGE_PURGE_CLAIM_LEASE_MS` (5
minutes — matching every other lock/lease TTL already used in this
codebase, e.g. `RunScheduledReconciliationSweepUseCase.LOCK_TTL_MS`,
`RetryPendingCloudinaryPurgesUseCase.LOCK_TTL_MS`), in addition to
setting `storagePurgeLastAttemptedAt`. A second claim's `WHERE
("storagePurgeNextAttemptAt" IS NULL OR "storagePurgeNextAttemptAt" <=
now)` check now correctly excludes a just-claimed row for the lease
duration, closing the gap `FOR UPDATE SKIP LOCKED` alone did not cover.

Under NORMAL operation this lease value is never actually observed:
`recordDocumentStoragePurgeFailure` (real computed backoff) and
`markDocumentStoragePurged` (`NULL`) both run synchronously, immediately
after the claim, within the same `runBatch` loop iteration, and both
unconditionally overwrite `storagePurgeNextAttemptAt` regardless of what
the claim set it to — so the lease is only ever actually relevant in
exactly the crash/stall case it exists for (the same "restart safety"
reasoning Module 92's cursor already established), never changing the
already-tested happy-path state transitions.

No schema/migration change: `storagePurgeNextAttemptAt` already existed
for exactly this purpose (its own doc comment already documents "bounded
exponential backoff") — this only makes the CLAIM step itself also write
to it, alongside the retry-outcome methods that already did.

## Database invariants preserved

- `Payment.stripePaymentIntentId` unique constraint: untouched, still
  the sole authority for "exactly one row" (Failure A's fix only changes
  what happens when a caller LOSES that constraint's race, never removes
  or weakens the constraint itself).
- `ProfessionalVerification.professionalProfileId` unique constraint
  (from the prior round's Group D fix): untouched, unrelated to this
  round.
- No `DocumentStoragePurgeStatus` enum values added or changed. No new
  column, no new migration. `storagePurgeNextAttemptAt`'s existing
  semantics (nullable, "earliest time eligible for retry") are extended
  to also cover "currently claimed," consistent with its own pre-existing
  doc comment's stated intent — not repurposed to mean something new.
- No retry/backoff/dead-letter semantics changed — `decidePurgeRetry`,
  `classifyStorageDeletionError`, and every state-machine transition in
  `RetryPendingCloudinaryPurgesUseCase` are untouched.

## Why the solution is safe under PostgreSQL concurrency

- **Failure A**: the database's own `stripePaymentIntentId` UNIQUE
  constraint is what actually guarantees "at most one row" — Postgres
  enforces this regardless of application code. The fix only changes how
  the LOSING caller of a race reacts to that guarantee being enforced
  (read the winner's row instead of crashing), which is safe by
  construction: whatever row exists after the constraint resolves the
  race is exactly what `findByStripePaymentIntentId` reads back, and
  Postgres guarantees that read is consistent (the constraint is
  enforced transactionally — a P2002 is only ever raised once some row
  has actually committed).
- **Failure B**: `FOR UPDATE SKIP LOCKED` remains the primary
  same-instant protection (unchanged — a genuinely simultaneous second
  claim still cannot select a row the first is actively locking). The
  added lease is the secondary, independent protection for the window
  after the claim statement's own transaction ends: it's written in the
  SAME atomic `UPDATE` as the claim itself (no separate round trip, no
  window for a third statement to interleave between "claim" and "set
  lease"), so a row is never observably claimed-without-a-lease from any
  other transaction's point of view. Postgres MVCC guarantees any
  subsequent transaction's `WHERE` evaluation sees the just-committed
  lease value, not a stale pre-claim one.

## Tests executed

- `npx tsc --noEmit` — clean, full repo, both changed files included.
- `git diff --check` — clean, no whitespace errors.
- Network reachability re-checked fresh, before diagnosis and again
  before this verification section: `nc -zv localhost 5432` →
  `Connection refused`, unchanged from every prior round this session —
  `device_bash` here still runs inside the Cowork desktop app's isolated
  Linux VM, separate from the user's Mac (`uname` → `Linux ... aarch64`
  vs. `get_device_info` → `platform: darwin`).
- `npm run test:integration:db -- tests/integration-db/financial/payment-uniqueness.test.ts tests/integration-db/gdpr/gdpr-cloudinary-purge-retry.test.ts`
  — confirmed the npm script DOES forward extra args to `vitest run`
  correctly (both target files were passed through). The run reaches
  `globalSetup`'s `prisma migrate deploy` step and fails there with the
  same pre-existing `binaries.prisma.sh` `403 Forbidden` this session has
  hit on every previous attempt (Prisma engine binaries cannot be
  downloaded from this sandbox) — before ever attempting a Postgres
  connection. This is the same environment boundary as every prior
  round, not something these two code changes caused or could have
  avoided.

**I did not watch either fix, or the full suite, actually pass against
real data — I am not claiming a pass.**

## Exact final result

Not obtained from this session (blocked as above). The user needs to
re-run these two commands themselves, from their own Mac terminal
(outside this device_bash session):

```
npm run test:integration:db -- tests/integration-db/financial/payment-uniqueness.test.ts tests/integration-db/gdpr/gdpr-cloudinary-purge-retry.test.ts
```
to confirm both specific fixes, then:
```
npm run test:integration:db
```
to confirm the full suite — target 15/15 files, 71/71 tests (the same
count as before; no test was added or removed this round, only two
repository methods and no test files were changed for these two
failures — see file list below).

## Files changed this round

- `src/core/infrastructure/database/prisma/repositories/prisma-payment-repository.ts`
  — `create()` now catches P2002 and re-reads by `stripePaymentIntentId`.
- `src/core/infrastructure/database/prisma/repositories/prisma-professional-verification-repository.ts`
  — added `STORAGE_PURGE_CLAIM_LEASE_MS`; `claimPendingStoragePurgeBatch()`
  now also advances `storagePurgeNextAttemptAt` to a short lease in the
  same atomic claim `UPDATE`.

No test files changed this round (unlike the prior round's Group C/D,
these two were genuine production bugs — the existing tests were already
correct and needed no fixture/seed changes).

## Remaining risks

1. **Needs the user's own re-run** on their Mac to confirm both fixes
   and the full 71/71 suite — nothing in this round was watched passing
   from this session, for the same environment reason as every prior
   round.
2. Failure B's fix assumes 5 minutes is comfortably longer than any real
   Cloudinary `destroy` call in production — consistent with every other
   TTL already chosen in this codebase for the identical reason, but
   worth the user's awareness if Cloudinary's real-world latency profile
   ever changes materially.
3. If the real run surfaces any OTHER failure not covered by this
   report (e.g. a third, previously-masked concurrency issue only
   visible once these two are fixed), that would need a fresh diagnosis
   pass — this report only covers the two failures actually reported.
