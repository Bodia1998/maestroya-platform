# Module 96 — Real PostgreSQL Integration Failure Analysis

Diagnosis and fixes for the 10/71 real-Postgres integration test failures
the user reported after running `npm run test:integration:db` for real on
their own Mac (61/71 passed). No secrets in this file. No git
add/commit/push, no branch change, no migrations renamed, no constraints
weakened.

## 1. Executive summary

Four independent failure groups, four independent root causes:

| Group | Classification | Root cause | Fix |
|---|---|---|---|
| A (6 failures) | **Production code bug** | Raw SQL referenced the Prisma *model* name (`"AffiliateCommission"`) instead of the `@@map`-ped physical table name (`affiliate_commissions`) | Corrected the raw SQL identifier |
| B | **Production code bug** | `getOrCreate()`'s `upsert()` can lose a genuine concurrent-insert race (two callers reach it outside `RunScheduledReconciliationSweepUseCase`'s lock on a cold start) and throw an unhandled P2002 | Catch P2002, re-read the row the other caller just created — the repo's own existing pattern |
| C | **Test expectation/seed bug** | Scenario 10's "stolen advance" simulated a position PAST the end of the entire seeded job ledger, so the next sweep correctly found nothing left and returned `skipped_empty` — the test's own expectation of `completed` was inconsistent with its own seed data | Seed the stolen-advance position genuinely mid-ledger (after the 2nd of 5 real Jobs), so the next sweep has real remaining work and correctly returns `completed` |
| D | **Test fixture bug** | "batch limit"/"concurrency" tests called `seedSoftDeletedDocument()` in a loop for the SAME `professionalProfileId`, each call creating a NEW `ProfessionalVerification` row — violating the model's own intentional one-verification-per-profile unique constraint | Seed ONE verification per profile, attach all the test's documents to that same verification (which has no such uniqueness) |

No unique constraint, guard, or business-semantics rule was weakened.
Groups A and B are genuine production bugs, now fixed. Groups C and D
were the tests themselves being wrong, now fixed without touching any
assertion's intent or any production code.

## 2. Exact starting result

61/71 passed, 10 failed, reported by the user from a real run on their
own Mac against their real local `maestroya_test` database (62
migrations applied, `TEST_DATABASE_URL` resolved correctly) — this is
genuine, not a config problem.

## 3. Group A root cause — raw SQL table-name mismatch (production bug)

`prisma/schema.prisma`:
```
model AffiliateCommission {
  ...
  @@map("affiliate_commissions")
}
```

`prisma-affiliate-commission-repository.ts`, `applyReversalAtomically()`
(the row-lock step every reversal — refund, dispute-lost, Stripe fee
reconciliation — goes through):
```
FROM "AffiliateCommission" WHERE id = ${affiliateCommissionId}::uuid FOR UPDATE
```

Postgres quoted identifiers are matched exactly and case-sensitively.
`"AffiliateCommission"` (the Prisma *model* name) is not the same
identifier as the actual `@@map`-ped physical table
`affiliate_commissions` — no such table exists under that exact quoted
name, hence `42P01: relation "AffiliateCommission" does not exist`. Every
OTHER query against this model works fine because Prisma-Client-
generated calls (`tx.affiliateCommission.findUnique`, `.update`, etc.)
already resolve the `@@map`ped name internally; only this one hand-
written raw query bypassed that and hardcoded the wrong name. Confirmed
by reading both the schema and the exact raw-SQL string, and by tracing
that `RecordAffiliateCommissionUseCase`'s reversal path and
`ReconcileAffiliateCommissionStripeFeeUseCase` both call
`applyReversalAtomically()` — explaining why both `reversal-concurrency.test.ts`
and `stripe-fee-reconciliation.test.ts` failed with the identical error.
Column identifiers (`"affiliateAmount"`, `"reversedAmount"`, `"status"`)
were already correct — this model has no per-field `@map`, so their
quoted camelCase names match the physical columns exactly.

## 4. Group B root cause — cursor create-race (production bug)

`RunScheduledReconciliationSweepUseCase.execute()` calls
`this.cursorRepo.getOrCreate(CURSOR_KEY)` from TWO different places,
outside the `DistributedLock`'s protection in one of them:
- Inside `runLocked()` (lock held) — the normal path.
- In the `result === null` branch (lock NOT acquired) — purely to read
  the cursor for the `skipped_locked` result.

On a cold start (no cursor row exists yet), the lock-loser's
unprotected `getOrCreate()` call can genuinely race against the lock-
holder's own `getOrCreate()` call inside the lock — both attempting to
create the same not-yet-existing `cursorKey` row concurrently. The
previous implementation's doc comment assumed Postgres/`upsert()` would
always silently resolve this; a real concurrent run instead threw an
unhandled Prisma P2002 unique-constraint violation. Fixed using this
repository's OWN existing, already-established pattern elsewhere in the
codebase (`PrismaPartnerPayoutRepository`, `PrismaDisputeRepository`,
etc.): catch P2002 specifically (nothing else), and re-read the row via
`findUniqueOrThrow` — the row the OTHER concurrent caller's insert just
committed. The unique constraint on `cursorKey` is untouched; this
change only makes losing the race a normal, handled outcome instead of
an unhandled exception.

## 5. Group C root cause — test seed data inconsistent with its own expectation (test bug)

Scenario 10 ("restart safety") seeded a "stolen advance" pointing the
cursor at `lastCreatedAt: new Date("2026-06-01...")` /
`lastJobId: randomUUID()` — a timestamp far past ALL 5 seeded Jobs
(created at `2026-01-01T00:00:00Z` + up to 4 seconds) and a Job id that
does not exist. The subsequent `sweep.execute()` call's keyset query
(`listJobIdsToInspectFromCursor({ after: <that position> })`) correctly
finds ZERO Jobs after that point — there is nothing left in the ledger
past a position beyond the last real Job — so the use case correctly
returns `outcome: "skipped_empty"` (and separately advances the cycle
counter, since `cycleCompleted` is true). The test's own assertion,
`expect(result.outcome).toBe("completed")`, was never achievable with
that seed data: "completed" only happens when a batch is actually
processed, and this stolen-advance position leaves no batch to process.
This is a test-seed bug, not a production bug — the production code's
`skipped_empty` result was the objectively correct answer for the state
the test itself created. Fixed by seeding the stolen-advance position
genuinely mid-ledger — right after the 2nd of the 5 real seeded Jobs
(using that Job's own real `id`/`createdAt`) — so the subsequent sweep
has 3 real remaining Jobs to find and process, matching the test's own
stated intent ("the system remains fully usable afterward ... proceeds
normally").

## 6. Group D root cause — test fixture reused a unique-constrained row (test bug)

`ProfessionalVerification.professionalProfileId` is intentionally
`@unique` — one verification per professional profile, never weakened.
The "batch limit" and "concurrency" tests each called
`seedSoftDeletedDocument(profile.id)` in a loop (5 and 8 times
respectively) for the SAME `profile.id`. That helper created a BRAND NEW
`ProfessionalVerification` row on every call — the 2nd call in each loop
violated the unique constraint and threw. This is a test-fixture bug:
the tests actually need several *documents* pending purge for one
profile, and `ProfessionalVerificationDocument.verificationId` carries
no uniqueness — many documents legitimately belong to one verification.
Fixed by splitting the seed helper: `seedVerification(profileId)` (called
once per test) and `seedSoftDeletedDocumentOnVerification(verificationId)`
(called once per document, all attached to that same verification). The
original `seedSoftDeletedDocument()` convenience wrapper (one
verification + one document) is kept, unchanged in behavior, for every
other scenario in the file that only ever needed one document.

## 7. Production bugs vs. test-only bugs

- **Production code changed** (Groups A, B):
  `src/core/infrastructure/database/prisma/repositories/prisma-affiliate-commission-repository.ts`,
  `src/core/infrastructure/database/prisma/repositories/prisma-reconciliation-schedule-cursor-repository.ts`.
- **Test-only changes** (Groups C, D):
  `tests/integration-db/financial/reconciliation-schedule-cursor.test.ts`,
  `tests/integration-db/gdpr/gdpr-cloudinary-purge-retry.test.ts`.
- No assertion was loosened to make it pass — Group C's assertion is
  unchanged (`toBe("completed")`); its SEED was fixed to make that
  correct outcome actually reachable. Group D's assertions are
  unchanged; only how documents are attached to verifications changed.
- No unique constraint, guard, or business-invariant was touched, removed,
  or weakened anywhere.

## 8. Exact files changed

- `src/core/infrastructure/database/prisma/repositories/prisma-affiliate-commission-repository.ts`
  — one raw-SQL identifier corrected (`"AffiliateCommission"` →
  `"affiliate_commissions"`), plus an explanatory comment.
- `src/core/infrastructure/database/prisma/repositories/prisma-reconciliation-schedule-cursor-repository.ts`
  — `getOrCreate()` now catches P2002 and re-reads on a lost concurrent-
  create race; imports `Prisma` from `@prisma/client`.
- `tests/integration-db/financial/reconciliation-schedule-cursor.test.ts`
  — Scenario 10's stolen-advance now uses a real, mid-ledger Job position
  instead of a past-the-end one; also asserts `recordsSelected === 3`
  for a stronger, more specific check of the fixed behavior.
- `tests/integration-db/gdpr/gdpr-cloudinary-purge-retry.test.ts` — seed
  helper split into `seedVerification` + `seedSoftDeletedDocumentOnVerification`
  (plus the unchanged `seedSoftDeletedDocument` convenience wrapper); the
  "batch limit" and "concurrency" tests now seed one verification with
  several documents instead of several verifications.

No other files touched this round. `.env`/`.env.local`/`.env.production`
untouched (as in every prior round). Nothing staged.

## 9. Database/schema changes

None. No migration added, renamed, or altered — Group A's fix is a raw
SQL string correction in application code, matching the task's own
migration rule ("if the root cause is a raw SQL string rather than a
schema/migration change, no new migration is needed"). `prisma/schema.prisma`
is unchanged.

## 10. Tests added/changed

No new test files. Two existing real-DB test files edited (see §8) —
fixing seed data/fixtures, not weakening or removing any assertion.

## 11. Final real PostgreSQL result — honest scope

**Network reachability re-checked fresh at the start of this round, before
any diagnosis work, and again after the fixes — unchanged from every
prior round in this session:** `device_bash` here still executes inside
the Cowork desktop app's isolated Linux VM (`uname -a` → `Linux claude ...
aarch64`), separate from the user's actual Mac (`get_device_info` →
`platform: darwin, arch: arm64, deviceName: macbook-air-bogdan-local`).
`nc -zv localhost 5432` → `Connection refused`, both times. `npx prisma
validate`/`generate` still fail with the same pre-existing `403
Forbidden` fetching `binaries.prisma.sh`, also unchanged.

**What WAS verified from this session, and how far:**
- All four root causes traced directly against the actual schema,
  migration-mapped table names, and raw SQL / use-case code — not
  guessed.
- `npx tsc --noEmit` — clean, full repo, including every file changed
  this round.
- `git diff --check` — clean, no whitespace errors.
- `npx vitest run --config vitest.config.integration-db.ts` against the
  four affected test files (with a real local-shaped `TEST_DATABASE_URL`
  in `.env.test.local`) — resolves the URL correctly, reaches
  `globalSetup`'s `prisma migrate deploy` step, and fails there with the
  same pre-existing `binaries.prisma.sh` 403 — i.e. it fails at the exact
  same environment boundary as every previous attempt this session, not
  at anything related to these code changes. This does NOT confirm the
  fixes work against live data.

**What is NOT verified from this session and needs the user's own
re-run:** the actual 71 real-Postgres tests, including whether the
previously-failing 10 now pass. **I did not watch `npm run
test:integration:db` complete, so I am not claiming a full pass** — per
the explicit instruction, this is reported as partially verified
(diagnosis + typecheck-level correctness), not complete.

## 12. Remaining risks

1. **Needs the user's own re-run on their Mac** (`npm run
   test:integration:db`, with their real `TEST_DATABASE_URL` in
   `.env.test.local`) to confirm all 71 tests pass, including the 6
   Group A tests, the Group B concurrent-cursor scenario, Scenario 10,
   and the batch-limit/concurrency GDPR tests.
2. Group B's fix assumes Postgres/Prisma's `upsert()` CAN lose a
   concurrent-insert race in this exact Prisma version/config — the fix
   is defensive and correct either way (a P2002 that never actually
   happens now is simply dead code on the happy path), but the real
   run is what will confirm whether the race is now fully absorbed.
3. If Group A's raw SQL has any other latent case-sensitivity issue not
   caught by this pass (none found in a full repo-wide grep of
   `$queryRaw`/`$executeRaw`, all others already reference already-
   correct snake_case mapped names), it would only surface on the real
   run.
