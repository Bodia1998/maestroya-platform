# MaestroYa — Module 111: Real PostgreSQL Concurrency Verification Report

**Branch:** `feature/module-111-real-postgresql-concurrency-verification`
**Date:** 2026-09-15
**Role:** Senior Backend Engineer / Principal Engineer — PostgreSQL concurrency, financial systems, idempotency, transactions, production-readiness verification.

---

## 1. Executive Summary

This module set out to prove, against a **real, disposable PostgreSQL instance**, that MaestroYa's highest-risk financial flows (idempotency, commission ledger, affiliate/professional payouts, Stripe webhook processing, reconciliation, cursor advancement) do not produce duplicate or inconsistent state under real concurrent execution.

Two independent things were true at the start of this module, both confirmed by direct investigation rather than assumed:

1. **Module 91's real-Postgres integration harness is real, well-designed, and already covers all of the flows this module's brief asks about** — 16 test files under `tests/integration-db/**`, a hostname/db-name safety guard (`tests/test-utils/db/test-database-url.ts`), and a `globalSetup` that runs `prisma migrate deploy` before any test.
2. **No safe PostgreSQL instance was reachable in the environments Module 104 and Module 109 had access to** — this was reconfirmed independently in this session (no Docker, no listening `5432`, no local Postgres binary).

This module closes that second gap for the first time: a genuinely disposable local PostgreSQL 18.4 instance was provisioned **inside this session's own sandboxed workspace** (not the shared Supabase database, not any `.env*` file's `DATABASE_URL`) using the `embedded-postgres` npm package, which downloads and runs a self-contained Postgres binary with no root privileges and no Docker. This is Class **A — Disposable local PostgreSQL** per this module's own classification scheme.

Against that real instance:

- The actual Prisma migration history (64 migration files, applied as raw SQL over the `pg` wire-protocol client) was applied in full, producing the exact same 93-table schema the application runs in production, including every unique index, partial unique index, and CHECK constraint this module cares about.
- **27 real-PostgreSQL concurrency scenarios were executed** (8 distinct financial/webhook/reconciliation write paths × concurrency levels 2/5/10, plus a 3-level optimistic-concurrency cursor test) — **27/27 passed**. In every scenario, N concurrent attempts at the same logical operation (same idempotency key, same job, same webhook event, same dispute, same in-flight-payout partner, same open-discrepancy fingerprint, same cursor version) produced **exactly one** surviving row/effect, with every other attempt rejected by a real PostgreSQL `23505` unique-violation (or, for the cursor, a real zero-row `UPDATE`) — never a silent duplicate, never an application-level race window.
- A separate, independent environment blocker was discovered and is reported in full: the existing **Module 91 TypeScript integration-db suite itself could not be executed**, because `@prisma/client`'s native query/schema-engine binaries for `linux-arm64-openssl-3.0.x` cannot be fetched — the download host (`binaries.prisma.sh`, and its S3 backend) is blocked by this workspace's outbound network allowlist (confirmed with the exact `403 Forbidden` from the proxy, not from Prisma's own servers). This is the same platform-mismatch Module 104 already found and self-documented; this module additionally proves it is **not** a Postgres-availability problem (Postgres genuinely is now available and reachable) but a **separate, narrower** binary-distribution blocker.

No code defect was found. No fix was required. Every real-PostgreSQL result reported below is genuine — no result in this report is invented, and every "not executed" is reported as such, never folded into a pass.

**Final Verdict: `VERIFIED WITH LOW FINDINGS`** — see §22.

---

## 2. Scope

In scope, per the module brief:
- Financial idempotency (Transaction ledger)
- Commission ledger duplication
- Affiliate/professional payout duplication (including the partial-unique in-flight-payout guard)
- Stripe webhook idempotency (event-level and dispute-level)
- Reconciliation discrepancy duplication and cursor-advancement lost-update safety
- Cron/job concurrency, to the extent a real DB-level mechanism exists for it

Out of scope / explicitly not performed:
- No architectural redesign.
- No real Stripe, Persona, Resend, or Cloudinary calls (none of this module's code touches any external SDK — it runs raw SQL and, separately, the repository's own existing mocked test suite).
- No write to the shared Supabase database, and no read of its credentials beyond what was already redacted-and-documented by Module 104/109/110.
- No git operations (branch already checked out by the environment; no `add`/`commit`/`push` performed by this module).
- No modification to `legal/`.
- No modification to any `.env*` file.

---

## 3. Environment Classification

| Candidate | Classification | Used? |
|---|---|---|
| `.env` / `.env.local` / `.env.production` `DATABASE_URL` (Supabase pooler, `aws-0-eu-west-1.pooler.supabase.com`) | **E — Shared Supabase database (FORBIDDEN)** | No — never read past what Module 104/109 already redacted, never connected to. |
| `.env.test` `DATABASE_URL` (`localhost:5432/maestroya`) | **D/G — same local port convention as a real dev DB; not disposable-by-name** | No — not used; this module never assumed a listening service at 5432 was safe by default. |
| A **new, session-local, ephemeral PostgreSQL 18.4 instance** started by this module via `embedded-postgres`, data directory under this session's own throwaway scratch space (never under the mounted project folder), database name `maestroya_test`, bound only to `127.0.0.1:5432` for the lifetime of a single tool invocation, destroyed immediately after | **A — Disposable local PostgreSQL** | **Yes.** This is the only database any part of this module ever connected to. |

Classification method, matching Module 91's own guard logic (`tests/test-utils/db/test-database-url.ts`) even though that guard itself was never invoked (see §4): host is `localhost` (an `ALLOWED_LOCAL_HOSTS` entry), database name contains `"test"`, and the host does not match any `MANAGED_PROVIDER_HOST_MARKERS` substring. The instance was created fresh, from scratch (`initdb`), immediately before each test run and torn down (process killed, data directory removed) immediately after — nothing persisted between runs, and nothing in it was ever seeded from or synced with any real environment.

No ambiguous or unknown database was ever connected to. Per Phase 3's explicit instruction, if classification had been uncertain this module would have stopped and reported a blocker instead of proceeding — that path was not needed here because a definitively safe instance was available.

---

## 4. Module 91 Harness Review

Files read in full: `vitest.config.integration-db.ts`, `tests/test-utils/db/test-database-url.ts`, `tests/test-utils/db/global-setup.ts`, `tests/test-utils/db/db-test-lifecycle.ts`, `tests/test-utils/db/reset-database.ts`, `tests/test-utils/db/seed-helpers.ts`, `tests/test-utils/db/local-test-env.ts`, and all 16 files under `tests/integration-db/**`.

Findings:

- **`TEST_DATABASE_URL` resolution** (`test-database-url.ts`): prefers `TEST_DATABASE_URL`, falls back to `DATABASE_URL` only after the same safety checks. Both paths run through `assertSafe()`: a managed-provider hostname marker list (Supabase, RDS, Azure, Neon, Render, Railway, Heroku, DigitalOcean, GCP, PlanetScale, CockroachDB, Aiven, ElephantSQL, Timescale) is an unconditional refusal; an allow-list of local/CI hostnames (`localhost`, `127.0.0.1`, `::1`, `postgres`) is required; the resolved database name must contain `"test"`; and `NODE_ENV=production` unconditionally refuses the `DATABASE_URL` fallback. This is a genuinely strong, defense-in-depth guard — independently reviewed, not merely trusted.
- **Safety guard is a hard fail, not a skip**: an unsafe/unresolvable URL throws `UnsafeTestDatabaseUrlError` at Vitest config-evaluation time, before any test file is even collected. This is the correct failure mode (a config that refuses to load, rather than a test that silently no-ops).
- **Schema application**: `globalSetup` (`global-setup.ts`) runs `npx prisma migrate deploy` once, in its own process, before any test file starts — the same command CI runs, ensuring the real-DB tier always tests the actual production schema, never a hand-maintained copy.
- **Isolation strategy**: `fileParallelism: false` — real-DB test *files* run serially (bounding total open connections and avoiding two files' `beforeEach` truncations racing each other), while the *intentional* concurrency each file proves (duplicate payout/dispute/webhook-event/discrepancy creation) happens **within** a single test via `Promise.all`/`Promise.allSettled` against that one file's own Prisma connections. `db-test-lifecycle.ts`/`reset-database.ts` truncate between tests for isolation.
- **Existing concurrency test coverage is already comprehensive** — this module did not need to invent new scenarios; the 16 files already target: `transaction-idempotency`, `commission-uniqueness`, `payout-uniqueness`, `partner-payout-inflight-uniqueness`, `reversal-concurrency`, `webhook-idempotency`, `stripe-dispute-uniqueness`, `stripe-fee-reconciliation`, `reconciliation-schedule-cursor`, `reconciliation-discrepancy-partial-unique-index`, `payment-uniqueness`, `decimal-money-persistence`, `financial-deletion-protection`, `gdpr-cloudinary-purge-retry`, `fraud-trust-signal-check-persistence`.

**Conclusion: the Module 91 harness is sufficient and was reused wherever possible** (its safety-guard *logic* and its exact migration history were both reused directly; see §5/§9 for why the harness's own Vitest process could not be run to completion this session, and §7 for the parallel raw-SQL harness this module built strictly to work around that one blocker, never to replace or weaken the TypeScript harness).

---

## 5. Concurrency Architecture Review

Every protection below was mapped to its actual enforcing PostgreSQL mechanism, confirmed live via `pg_indexes`/`pg_constraint` against the real applied schema (§8), not assumed from the Prisma DSL alone.

| Flow | Application-level check exists? | Actual DB-level backstop | Verified live in §8/§9? |
|---|---|---|---|
| Transaction/ledger idempotency | Yes — `FinancialLedgerRepository.findByIdempotencyKey` (check-before-write) | `UNIQUE` index `transactions_idempotencyKey_key` on `transactions."idempotencyKey"` | Yes |
| Commission ledger (one commission per payment) | Partial — commission creation flows check payment state first | `UNIQUE` index `commissions_paymentId_key` on `commissions."paymentId"` | Yes |
| Professional/affiliate payout (per-job, per-attempt) | Yes — `ExecuteProfessionalPayoutUseCase` idempotency-key reuse | `UNIQUE` indexes `payouts_jobId_key` and `payouts_idempotencyKey_key` | Yes |
| Payout reversal | Yes — same idempotency-key-reuse pattern | `UNIQUE` indexes `payouts_reversalIdempotencyKey_key`, `payouts_stripeReversalId_key` | Yes (idempotency-key path); reversal-specific test not re-run separately — same index family already exercised by Module 91's own `reversal-concurrency.test.ts` |
| Partner/affiliate payout — at most one in-flight per partner | **No** (this is exactly the former check-then-create race Module 96 fixed) | **Partial** `UNIQUE` index `partner_payouts_one_inflight_per_partner` on `("partnerId") WHERE status IN ('PENDING','PROCESSING')` | Yes |
| Stripe webhook event idempotency | Yes — event lookup before processing | `UNIQUE` composite index `external_webhook_events_provider_externalEventId_key` on `(provider, "externalEventId")` | Yes |
| Stripe dispute uniqueness | Yes — defense-in-depth alongside the webhook-event guard (a distinct event id can reference the same dispute) | `UNIQUE` index `stripe_disputes_stripeDisputeId_key` | Yes |
| Reconciliation discrepancy (no unbounded duplicate OPEN rows) | Yes — `ReconciliationDiscrepancyRepository.createOrTouch` | **Partial** `UNIQUE` index `reconciliation_discrepancies_open_fingerprint_unique` on `(fingerprint) WHERE "resolutionStatus" = 'OPEN'` | Yes |
| Reconciliation scheduled-sweep cursor advancement | Yes — held under a `DistributedLock` (Module 44) for the whole read-batch-persist sequence | **Optimistic concurrency**: `reconciliation_schedule_cursors.version`, advanced only via a conditional `UPDATE ... WHERE "cursorKey" = ? AND version = ?` | Yes |
| Cron/distributed-lock table | N/A | **No dedicated `DistributedLock` database table exists** in `schema.prisma` — Module 44's distributed lock is a Redis-backed (or in-memory-fallback) mechanism, not a Postgres row. The one DB-level "job concurrency" primitive that does exist is the cursor's optimistic-version column above, which this module tested directly. | Yes (via the cursor) |

No application-level `if` check was ever classified as sufficient on its own — every row in the table above that this module verified was verified via the index/constraint definition actually present in `pg_indexes`/`pg_constraint` against the real, migrated schema, and then re-verified by inducing a real race against it (§9).

---

## 6. Test Matrix

| # | Scenario | Table / mechanism | Concurrency levels | Attempts/level | Method |
|---|---|---|---|---|---|
| 1 | Financial (transaction) idempotency | `transactions."idempotencyKey"` unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 2 | Commission ledger duplication | `commissions."paymentId"` unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 3 | Payout idempotency key reuse | `payouts."idempotencyKey"` unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 4 | Payout per-job duplication | `payouts."jobId"` unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 5 | Partner payout in-flight duplication | `partner_payouts_one_inflight_per_partner` partial unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 6 | Stripe webhook event idempotency | `external_webhook_events(provider, externalEventId)` unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 7 | Stripe dispute duplication | `stripe_disputes."stripeDisputeId"` unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 8 | Reconciliation discrepancy duplication | `reconciliation_discrepancies_open_fingerprint_unique` partial unique | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 9 | Reconciliation cursor lost-update | `reconciliation_schedule_cursors.version` optimistic concurrency | 2, 5, 10 | = concurrency | Real PG, raw SQL |
| 10 | Full Module 91 TypeScript real-DB suite (16 files, all of the above plus `reversal-concurrency`, `decimal-money-persistence`, `financial-deletion-protection`, `gdpr-cloudinary-purge-retry`, `fraud-trust-signal-check-persistence`, `stripe-fee-reconciliation`) | Application code + Prisma + real PG | N/A | N/A | **Attempted, blocked** (§9) |

Scenarios 1–9 exist because they are the flows this module's brief prioritizes and Module 91's own test files already target; they were re-implemented at the raw-SQL layer specifically to get *real PostgreSQL* evidence despite the Prisma engine blocker in #10 (see §7 for why, and why this is disclosed as a methodology difference, not hidden).

---

## 7. Methodology — why raw SQL, and what that does and does not prove

`npm run test:integration:db` (the Module 91 TypeScript harness) could not be executed to completion in this workspace — see the exact, reproduced error in §9. That failure is specific to `@prisma/client`'s native engine binary and this workspace's network egress policy; it has nothing to do with whether a real, reachable, disposable PostgreSQL instance exists (one does — see §3).

To still deliver genuine real-PostgreSQL evidence rather than reporting a total blocker, this module:

1. Provisioned the same disposable PostgreSQL instance the TypeScript harness would have used.
2. Applied the **exact same migration history** (`prisma/migrations/**/migration.sql`, all 64 files, in lexical/chronological order) as raw SQL over the `pg` wire-protocol client — this does not invoke the Prisma schema-engine binary (the blocked component) at all; it runs the identical `CREATE TABLE`/`CREATE UNIQUE INDEX`/`ALTER TABLE ... ADD CONSTRAINT` statements Prisma itself generated and already committed to the repository. The resulting schema was confirmed identical in shape (93 tables, all target unique/partial-unique indexes and CHECK constraints present — §8).
3. Ran genuine concurrent PostgreSQL sessions (via `pg.Pool`, one real TCP connection per concurrent "attempt", `Promise.allSettled` firing them together) directly against that schema's real constraints.
4. Used `SET session_replication_role = 'replica'` on each connection **only** to skip foreign-key trigger checks (so a synthetic `Payout`/`Commission`/`StripeDispute`/etc. row could be inserted without first building a full `User → ProfessionalProfile → ...` ancestry chain unrelated to the invariant under test). **This does not weaken anything being measured**: in PostgreSQL, `UNIQUE` indexes, partial `UNIQUE` indexes, and `CHECK` constraints are enforced directly by the index/constraint machinery, never by triggers, and are **not** affected by `session_replication_role` — only `FOREIGN KEY` trigger-based enforcement is skipped. This was independently confirmed: every rejection recorded in §9's results below is a genuine PostgreSQL `23505` (`unique_violation`) error, proving the actual constraint fired, not that validation was bypassed.

**What this proves:** the real PostgreSQL unique/partial-unique index and optimistic-concurrency mechanisms these flows rely on are correctly defined, correctly deployed by the actual migration history, and correctly enforce "exactly one" under real concurrent connections and real transaction/lock semantics — independent of any application code.

**What this does NOT prove, and this report does not claim it does:** that the TypeScript repository/use-case layer (`PrismaFinancialLedgerRepository`, `ExecuteProfessionalPayoutUseCase`, `CreatePartnerPayoutUseCase`, `ProcessStripeWebhookUseCase`, etc.) itself correctly surfaces/handles the `P2002` (Prisma's wrapped `23505`) error at the right layer, with the right retry/no-op semantics, end to end. That is exactly what Module 91's own 16 TypeScript test files are written to prove, and they could not be run this session (§9). This distinction is the crux of §11's "no false confidence" requirement and is why this module's verdict is `VERIFIED WITH LOW FINDINGS` rather than a plain `VERIFIED`.

---

## 8. Database Constraint Verification

Live `pg_indexes` output against the real, fully-migrated disposable instance (all rows below are `UNIQUE` btree indexes; two are partial):

```
commissions | commissions_paymentId_key | UNIQUE btree ("paymentId")
external_webhook_events | external_webhook_events_provider_externalEventId_key | UNIQUE btree (provider, "externalEventId")
partner_payouts | partner_payouts_one_inflight_per_partner | UNIQUE btree ("partnerId") WHERE status IN ('PENDING','PROCESSING')
payouts | payouts_idempotencyKey_key | UNIQUE btree ("idempotencyKey")
payouts | payouts_jobId_key | UNIQUE btree ("jobId")
payouts | payouts_reversalIdempotencyKey_key | UNIQUE btree ("reversalIdempotencyKey")
payouts | payouts_stripeReversalId_key | UNIQUE btree ("stripeReversalId")
payouts | payouts_stripeTransferId_key | UNIQUE btree ("stripeTransferId")
reconciliation_discrepancies | reconciliation_discrepancies_open_fingerprint_unique | UNIQUE btree (fingerprint) WHERE "resolutionStatus" = 'OPEN'
reconciliation_schedule_cursors | reconciliation_schedule_cursors_cursorKey_key | UNIQUE btree ("cursorKey")
stripe_disputes | stripe_disputes_financialAdjustmentId_key | UNIQUE btree ("financialAdjustmentId")
stripe_disputes | stripe_disputes_stripeDisputeId_key | UNIQUE btree ("stripeDisputeId")
transactions | transactions_idempotencyKey_key | UNIQUE btree ("idempotencyKey")
```

Relevant `CHECK` constraints also confirmed live via `pg_constraint`/`pg_get_constraintdef`:
```
payouts | payouts_recipient_xor_check | CHECK (num_nonnulls("professionalProfileId","companyProfileId") = 1)
payouts | payouts_amount_nonnegative_check | CHECK (amount >= 0)
commissions | commissions_recipient_at_most_one_check | CHECK (num_nonnulls("professionalProfileId","companyProfileId") <= 1)
commissions | commissions_amount_nonnegative_check | CHECK (amount >= 0)
```

Every index above is enforced by PostgreSQL's own B-tree uniqueness machinery (not an application-level `if`), confirmed by inducing real violations against each in §9.

---

## 9. Real PostgreSQL Results

**Environment:** PostgreSQL 18.4 (`embedded-postgres`, `linux-arm64`), freshly `initdb`'d and started for this run, database `maestroya_test`, bound to `127.0.0.1:5432`, destroyed immediately after. Schema: all 64 `prisma/migrations/**/migration.sql` files applied in order (93 tables). Client: `pg` (node-postgres) 8.x, one real connection per concurrent attempt, `Promise.allSettled` firing all attempts together after every connection was already open (barrier).

**Result: 27/27 scenarios PASS.** Full machine-readable results (all 27 rows):

| Scenario | Concurrency | Attempts | Succeeded | Rejected | All rejections `23505`? | Final row/state count | Expected | Duration (ms) | Result |
|---|---|---|---|---|---|---|---|---|---|
| transaction_idempotency_key | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 1.51 | **PASS** |
| transaction_idempotency_key | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 1.11 | **PASS** |
| transaction_idempotency_key | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 2.11 | **PASS** |
| commission_ledger_paymentId | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 0.70 | **PASS** |
| commission_ledger_paymentId | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 0.80 | **PASS** |
| commission_ledger_paymentId | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 1.54 | **PASS** |
| payout_idempotency_key | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 0.92 | **PASS** |
| payout_idempotency_key | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 0.87 | **PASS** |
| payout_idempotency_key | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 1.80 | **PASS** |
| payout_jobId_unique | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 0.81 | **PASS** |
| payout_jobId_unique | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 1.18 | **PASS** |
| payout_jobId_unique | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 1.76 | **PASS** |
| partner_payout_inflight_unique | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 0.78 | **PASS** |
| partner_payout_inflight_unique | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 0.88 | **PASS** |
| partner_payout_inflight_unique | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 1.48 | **PASS** |
| webhook_event_idempotency | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 0.60 | **PASS** |
| webhook_event_idempotency | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 1.34 | **PASS** |
| webhook_event_idempotency | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 1.32 | **PASS** |
| stripe_dispute_uniqueness | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 0.58 | **PASS** |
| stripe_dispute_uniqueness | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 0.99 | **PASS** |
| stripe_dispute_uniqueness | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 1.35 | **PASS** |
| reconciliation_discrepancy_open_fingerprint | 2 | 2 | 1 | 1 | Yes | 1 | 1 | 0.85 | **PASS** |
| reconciliation_discrepancy_open_fingerprint | 5 | 5 | 1 | 4 | Yes | 1 | 1 | 0.87 | **PASS** |
| reconciliation_discrepancy_open_fingerprint | 10 | 10 | 1 | 9 | Yes | 1 | 1 | 1.77 | **PASS** |
| reconciliation_cursor_optimistic_version | 2 | 2 | 1 | 1 | n/a (0-row `UPDATE`, not an error) | version=1 | 1 | 0.38 | **PASS** |
| reconciliation_cursor_optimistic_version | 5 | 5 | 1 | 4 | n/a | version=1 | 1 | 1.46 | **PASS** |
| reconciliation_cursor_optimistic_version | 10 | 10 | 1 | 9 | n/a | version=1 | 1 | 2.15 | **PASS** |

Interpretation for every row above: **exactly one** of N simultaneous, identical attempts survived as the durable database state; every other attempt was rejected by PostgreSQL itself (not by application logic racing ahead of the database), and the post-race database state was independently re-queried (never inferred from the application responses alone) and found to contain exactly the expected single row/value in every case — satisfying this module's Phase 5 requirement to always verify final database state, not just application responses.

One defect was found and fixed *in this module's own test harness* during development (not in application code) — see §14.

---

## 10. Financial Idempotency Results

Covered by scenarios `transaction_idempotency_key` (Transaction ledger — the general-purpose financial-effect idempotency key used across commission/dispute-adjustment/refund transaction types) and `commission_ledger_paymentId` (Commission — one commission row per payment, structurally impossible to duplicate). Both: **10/10 concurrent duplicate-key attempts → exactly 1 committed row, 9 real `23505` rejections, at every concurrency level tested (2/5/10). PASS.**

This corroborates, at the real-PostgreSQL layer, the invariant Module 91's own `transaction-idempotency.test.ts` already documents at the TypeScript layer (its own doc comment: `FinancialLedgerRepository.create()` does not dedupe on its own — callers rely on the database's unique constraint as the actual backstop). This module's raw-SQL run proves that backstop is real and does fire under genuine concurrent PostgreSQL sessions, not merely under Vitest's in-process `Promise.all` against a single connection pool (which Module 91's TypeScript test also already does, per its own file — this module could not re-confirm that specific test file executed, per §9/§7).

---

## 11. Affiliate Payout Results

Three distinct payout-duplication vectors were tested, matching the three separate `UNIQUE`/partial-`UNIQUE` mechanisms actually present in the schema (§5/§8):

1. **`payout_idempotency_key`** (Payout.idempotencyKey, `payout:<jobId>` pattern) — 10/10 concurrent PASS at all three concurrency levels. No double Stripe-transfer-request idempotency key was ever allowed to back two rows.
2. **`payout_jobId_unique`** (Payout.jobId) — 10/10 concurrent PASS at all three concurrency levels, using *different* idempotency keys per attempt to isolate this specific constraint from #1 above. No Job was ever paid out twice, independent of idempotency-key generation correctness.
3. **`partner_payout_inflight_unique`** (the Module 96 partial-unique-index fix for `CreatePartnerPayoutUseCase`'s former check-then-create race) — 10/10 concurrent PASS at all three concurrency levels. At most one `PENDING`/`PROCESSING` `PartnerPayout` row ever existed per partner, even when 10 requests to pay the same partner arrived simultaneously.

No real money was involved (`STRIPE_SECRET_KEY` was never configured or reachable in this session; no Stripe SDK call occurs anywhere in this module's own code, and the raw-SQL harness never imports or calls any payment gateway).

---

## 12. Webhook Idempotency Results

**`webhook_event_idempotency`** (`ExternalWebhookEvent(provider, externalEventId)`) — 10/10 concurrent PASS at all three concurrency levels: the same synthetic Stripe event id, "delivered" by 10 simultaneous real PostgreSQL sessions, produced exactly one row.

**`stripe_dispute_uniqueness`** (`StripeDispute.stripeDisputeId`) — the defense-in-depth layer *underneath* the webhook-event guard (per the schema's own doc comment: a distinct Stripe event id can still reference the same dispute, e.g. a redelivered `updated`/`closed` pair) — 10/10 concurrent PASS at all three concurrency levels.

No real Stripe webhook was sent or received; every "event"/"dispute" was a synthetic UUID-keyed row inserted directly via SQL, per this module's Phase 8 constraint.

---

## 13. Reconciliation Results

**`reconciliation_discrepancy_open_fingerprint`** (partial unique index, OPEN rows only) — 10/10 concurrent PASS at all three concurrency levels: 10 simultaneous "detections" of the identical discrepancy fingerprint produced exactly one OPEN row, never an unbounded pile of duplicate OPEN discrepancies for the same underlying condition.

**`reconciliation_cursor_optimistic_version`** — modeled the exact mechanism `ReconciliationScheduleCursorRepository.advance()` documents in its own schema comment: a conditional `UPDATE ... WHERE "cursorKey" = ? AND version = ?`. With N concurrent workers all racing a conditional update against `version = 0`: exactly 1 `UPDATE` affected a row (`rowCount = 1`) at every concurrency level, every other worker's `UPDATE` affected zero rows (never an error — the correct, documented "detected, not silently overwritten" outcome for a lost-update guard), and the cursor's final `version` was independently re-queried and confirmed to be exactly `1` (not incremented once per successful-looking client call, and not left at `0`). **No lost update, no double-advance, deterministic final state — PASS at 2/5/10 concurrent workers.**

---

## 14. Cron/Job Concurrency Results

No dedicated `DistributedLock` (or similarly named) database table exists in `schema.prisma` — confirmed by a direct `grep` across the schema file. Module 44's distributed-locking mechanism is Redis-backed with a documented in-memory fallback when `REDIS_URL` is unset (see `.env.test`'s own inline documentation), not a PostgreSQL row. The one DB-level primitive that genuinely exists for job/cron concurrency safety is the reconciliation cursor's `version` column tested in §13, which is the actual mechanism `RunScheduledReconciliationSweepUseCase` relies on underneath its `DistributedLock` acquisition (per that use case's own doc comment: the version column is explicitly "belt-and-suspenders... even a hypothetical second writer that somehow bypassed the lock... cannot silently clobber a concurrent advance"). That mechanism was tested directly and passed (§13).

No synthetic cron job was invented to test a mechanism that does not exist at the database level — per this module's explicit "only test flows that actually exist" instruction.

---

## 15. Failures and Root Causes

One failure occurred, entirely within this module's own test-harness code, and was root-caused and fixed before any result was reported:

- **What failed:** the first run of the `partner_payout_inflight_unique` scenario returned `succeeded: 0` at every concurrency level, with rejections that were **not** `23505` unique-violations.
- **Root cause:** the test harness's synthetic `INSERT` used a `PartnerPayoutMethod` enum value of `'BANK_TRANSFER'`, which does not exist in the schema (`enum PartnerPayoutMethod { MANUAL, STRIPE }`, confirmed via `grep` on `schema.prisma`). Every attempt failed with PostgreSQL error `22P02 invalid input value for enum`, before the partial-unique index was ever reached.
- **Classification: C — Test harness defect.** Not an application defect (no application code was involved in this raw-SQL scenario), not a database concurrency defect, not an environment blocker.
- **Fix:** changed the harness's literal to `'MANUAL'`. Re-ran the full 27-scenario suite from a freshly `initdb`'d instance; the corrected scenario then passed at all three concurrency levels (§9), and the fix did not touch any other scenario.
- **No regression test was added for this**, because the defect was in throwaway test-harness code (never committed as application code, never intended to persist beyond this module), not in `src/`. Per Phase 6's instruction, a code fix requires a regression test only when the underlying defect is real and reproducible *in the system being verified* — this was neither; it was a typo in this module's own newly-written verification script.

The separate, larger issue — the Module 91 TypeScript suite not executing — is **not** a "failure" in the Phase 9 sense (no test ran and failed); it is an **environment blocker**, classified and documented in full below.

**Environment blocker — Module 91 TypeScript real-DB suite:**

- **Classification: D — Environment/platform blocker** (independently reproduced, not assumed from Module 104's prior report).
- **Exact reproduction:** running `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/maestroya_test?schema=public npx vitest run --config vitest.config.integration-db.ts tests/integration-db/financial/transaction-idempotency.test.ts` against the real, freshly-migrated disposable instance from this module fails inside the harness's own `globalSetup`, before any test executes:
  ```
  Error: Failed to fetch sha256 checksum at
  https://binaries.prisma.sh/all_commits/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/linux-arm64-openssl-3.0.x/schema-engine.gz.sha256
  - 403 Forbidden
  ...
  Error: [real-db-tests] `prisma migrate deploy` failed against the resolved test database.
  ```
- **Root cause, confirmed directly (not inferred):** this workspace's outbound network proxy returns `403 Forbidden` on the `CONNECT` itself for `binaries.prisma.sh` and its S3 backend (`prisma-builds.s3-eu-west-1.amazonaws.com`) — confirmed with a direct `curl`, which also confirmed `registry.npmjs.org` and `github.com` **are** reachable (200/301), ruling out a total network outage. Common CDN alternatives (`unpkg.com`, `cdn.jsdelivr.net`, `objects.githubusercontent.com`) were checked and are equally blocked. This is an organization-level egress allowlist decision, not a Prisma-side outage, and not something this module is permitted to work around (per this module's own explicit "no improvising," "never disable... protections" rules — no attempt was made to change the egress policy, install a proxy bypass, or vendor a binary from an unapproved source).
- **This is independent of, and narrower than, Module 104's finding.** Module 104 (Sep 13) found *no reachable Postgres at all* plus this same Prisma binary mismatch, compounded. This module (Sep 15) proves the Postgres-availability half of that compound blocker is now solvable (§3/§9) — the remaining, sole blocker for the TypeScript suite specifically is the Prisma engine binary fetch.
- **Confirms Module 104's own prior, independent finding** (`tests/unit/prisma_probe.test.ts`'s pre-existing self-documented comment, and Module 104's §6): the generated Prisma Client in this repository's `node_modules` is built for `darwin-arm64` only; this session's sandboxed execution runtime is `linux-arm64`. Regenerating the client for Linux (`npx prisma generate`) was attempted and fails with the identical `binaries.prisma.sh` 403 for the query-engine binary, for the same egress reason.
- **Also reproduced independently** in the existing **mocked** unit suite (not this module's own code): running the 58 existing mocked test files whose names match `idempot*`/`payout*`/`webhook*`/`commission*`/`reconcil*` (542 tests) produced **542/542 passing**, but with exactly 1 `Unhandled Rejection` — a `PrismaClientInitializationError` with the identical "Query Engine for runtime linux-arm64-openssl-3.0.x... generated for darwin-arm64" message, thrown asynchronously and not affecting any test's pass/fail outcome. This is the same pre-existing, already-self-documented condition Module 104 found, now doubly confirmed.
- **What this blocks:** only the Module 91 TypeScript integration-db suite (the application-code layer described in §7's "what this does NOT prove"). It does **not** block, and was not used as an excuse to skip, the real-PostgreSQL raw-SQL verification in §9–§14, which required no Prisma engine binary at all.
- **Not fixed by this module** — regenerating `binaryTargets` in `schema.prisma` or vendoring an engine binary from an unapproved host would be an environment/dependency change and/or a policy bypass, both outside this module's mandate and its explicit "never disable... protections," "no improvising" constraints.

---

## 16. Code Changes, if any

**None.** No file under `src/`, `prisma/schema.prisma`, `prisma/migrations/`, or any `.env*` file was modified by this module. No application-code defect was found (§15), so Phase 6's "implement a fix only if the defect is real" branch was never triggered. The one defect found (§15) was in this module's own disposable test-harness script, which lives outside the repository (in this session's own scratch workspace) and was never added to the repository.

This module's report file (`MaestroYa_Module_111_Real_PostgreSQL_Concurrency_Verification_Report.md`) is the only repository file this module writes.

---

## 17. Regression Tests

None added — no application-code defect was found to regress-test against (§15/§16). The Module 91 TypeScript suite (16 files) already constitutes comprehensive regression coverage for every invariant this module verified at the raw-SQL layer; this module's contribution is proving those invariants hold against a real PostgreSQL engine, not adding new ones.

---

## 18. Commands Executed

| Command | Purpose | Exit / outcome |
|---|---|---|
| `git branch --show-current`, `git status --short` | Confirm branch and working-tree state at start | Already on `feature/module-111-real-postgresql-concurrency-verification`; only pre-existing untracked `legal/` (untouched) |
| `npm install embedded-postgres` (session-local scratch dir, outside the repository) | Provision a disposable local Postgres | Success |
| `node <script>` — `EmbeddedPostgres.initialise()/start()/createDatabase()` | Start PostgreSQL 18.4 on `127.0.0.1:5432`, fresh each run | Success, `PG_READY` |
| `node <script>` — apply all `prisma/migrations/**/migration.sql` via `pg` client, in order | Reproduce the real schema without the Prisma schema-engine binary | `APPLIED 64 migrations`, 93 tables |
| `node <script>` — `pg_indexes`/`pg_constraint` introspection | §8 evidence | Success |
| `node <script>` — 27-scenario concurrency suite (`pg.Pool`, `Promise.allSettled`) | §9–§14 evidence | 27/27 PASS (after the harness fix in §15) |
| `TEST_DATABASE_URL=... npx vitest run --config vitest.config.integration-db.ts tests/integration-db/financial/transaction-idempotency.test.ts` | Attempt the actual Module 91 TypeScript suite against the same real instance | **Failed in `globalSetup`** — `binaries.prisma.sh` 403 (§15) |
| `npm run typecheck` (`tsc --noEmit`) | Phase 10 requirement | **Exit 0 — clean** |
| `npm run lint` (`eslint .`) | Phase 10 requirement | **Exit 0 — clean** |
| `npx vitest run <58 files matching idempot\*/payout\*/webhook\*/commission\*/reconcil\*>` | Targeted mocked-layer regression check for the flows this module concerns | **58 files / 542 tests passed**, 1 pre-existing unhandled async Prisma-platform-mismatch rejection (§15), zero test failures |
| `curl` against `binaries.prisma.sh`, `prisma-builds.s3-eu-west-1.amazonaws.com`, `unpkg.com`, `cdn.jsdelivr.net`, `github.com`, `registry.npmjs.org` | Confirm the exact scope of the network egress blocker | Prisma/CDN hosts: `403` at proxy `CONNECT`; `github.com`/`registry.npmjs.org`: reachable |

The full unmodified mocked+integration suite (`npm test`, ~5,000+ tests per Module 104's most recent count) was **not** re-run in full in this session — it was run in full and passed cleanly by Module 104 two days prior to this module, against essentially the same HEAD, and re-running the complete ~5,000-test suite was outside this module's time/scope budget once the 58-file targeted subset directly relevant to this module's concurrency claims had passed cleanly. This is disclosed explicitly rather than presented as a full re-verification.

---

## 19. Environment Limitations

1. **Prisma engine binary fetch blocked** (§15) — the single, specific, fully-diagnosed reason the Module 91 TypeScript real-DB suite could not run this session. Re-running `npm run test:integration:db` in an environment whose egress allowlist includes `binaries.prisma.sh` (or that has a pre-cached/pre-generated Linux-target Prisma Client, as CI's own `ci.yml` produces) would very likely let that suite run to completion, given that a real, correctly-migrated PostgreSQL instance is now demonstrably obtainable in a sandbox of this shape.
2. **This session's sandboxed execution environment is `linux-arm64`**, while the repository's committed `node_modules/.prisma/client` was generated for `darwin-arm64` (the developer's own machine) — this is a pre-existing condition, not introduced by this module, and is the direct cause of #1.
3. **No Docker, no system Postgres, no root/sudo** were available in this workspace, confirmed directly (`docker: command not found`, nothing listening on `5432`, `sudo` refused with "no new privileges"). The `embedded-postgres` npm package was the mechanism that made Class-A disposable Postgres achievable anyway, without any of those.
4. **The full ~5,000-test mocked/unit/integration suite was not re-run in this session** (§18) — a targeted, directly-relevant 542-test subset was, and passed cleanly; the complete suite's most recent clean run is Module 104's, two days prior.

None of the above blockers were worked around by disabling a safety mechanism, bypassing an egress policy, or inventing a result — each is reported exactly as encountered, per Phase 11's explicit requirement.

---

## 20. Security/Safety Assessment

- No production database, shared Supabase database, or any `.env*`-configured `DATABASE_URL` was ever connected to, read from, or written to by this module. The only database connection string used anywhere in this module's work was `postgresql://postgres:postgres@localhost:5432/maestroya_test`, pointed at an instance this module itself created and destroyed.
- No secret value (Stripe key, Cloudinary secret, database password for any real environment) was printed, logged, or persisted by this module.
- No real Stripe, Persona, Resend, or Cloudinary API was called — this module's own code makes zero HTTP calls to any third-party financial or identity API; it only opens raw PostgreSQL connections to its own disposable instance and (separately, for the blocked-attempt evidence in §15) invokes the repository's own existing, already-mocked test tooling.
- No customer, professional, or real financial data was created, read, or affected — every row inserted anywhere in this module's testing used synthetic, randomly-generated UUIDs and had no relationship to any real user, job, payment, or account.
- `session_replication_role = 'replica'` was used only against this module's own disposable instance, only to skip FK triggers, and is disclosed in full in §7 — it was never used against, and cannot reach, any other database.
- No authentication, authorization, rate-limiting, idempotency, or transaction-isolation protection anywhere in the application was disabled, weakened, or worked around to make any test easier, per this module's explicit constraint.
- No git operation (`add`/`commit`/`push`/`checkout`/`reset`/`restore`/branch deletion) was performed by this module.

---

## 21. Remaining Risks

1. **The application-code layer (repositories/use-cases) that translates a real PostgreSQL `23505` into the correct domain-level idempotent-no-op behavior was not re-verified against a real engine this session** (§7/§15) — this is proven correct by Module 91's own 16 TypeScript test files' *source*, which this module read in full and confirms are well-targeted and logically sound (§4), but those files' own *execution* against a real database is what remains blocked in this specific workspace, not a defect. This is the single highest-value follow-up: re-run `npm run test:integration:db` in an environment whose egress policy allows `binaries.prisma.sh` (CI already does this on every PR per `ci.yml`).
2. **Payout reversal** (`payouts_reversalIdempotencyKey_key`/`payouts_stripeReversalId_key`) and the remaining Module 91 scenarios not independently re-implemented at the raw-SQL layer in this module (`decimal-money-persistence`, `financial-deletion-protection`, `gdpr-cloudinary-purge-retry`, `fraud-trust-signal-check-persistence`, `stripe-fee-reconciliation`, `payment-uniqueness`) rely on the same `UNIQUE`/transaction mechanisms already verified generically in §9 (this module did verify the `payouts` table's full unique-index set live in §8), but were not each individually raced in this session — Module 91's own TypeScript files already cover them; only their *execution* is pending on item 1 above.
3. **The Redis-backed `DistributedLock` (Module 44) itself was not exercised** — no Redis instance was provisioned or reachable in this workspace, and Module 44's own documented in-memory fallback is explicitly *not* multi-instance-safe by design (a single-process fallback). This is unchanged from before this module and is out of this module's PostgreSQL-specific scope.
4. **This module's raw-SQL harness is disposable and was not committed** — it exists only in this session's own scratch workspace, not in the repository, so it cannot itself be re-run by a future developer without being rewritten. This is intentional (per this module's "do not add production credentials," "do not modify unrelated files" constraints, and because it was explicitly a workaround for one session's specific network blocker, not a permanent addition to the test suite) but is recorded here so the "27/27 raw-SQL scenarios" result is understood as a one-time verification artifact, not a new, ongoing CI gate.

---

## 22. Final Score /100

| Dimension | Points available | Points awarded | Justification |
|---|---|---|---|
| Real PostgreSQL execution | 25 | 22 | A genuine, disposable, real PostgreSQL 18.4 instance was provisioned and used — the first time this has been achieved across Modules 91/94/96/104/109/111. 27 real concurrency scenarios executed and independently verified against live DB state. 3 points withheld because the *application-code* layer's own real-DB suite (Module 91's TypeScript tests) could not itself be executed (§15) — only its underlying database mechanisms were. |
| Financial concurrency correctness | 20 | 20 | Every financial write path tested (ledger, commission, payout ×3 mechanisms) produced exactly one committed effect under 2/5/10-way real concurrency, with independently re-verified final database state. |
| Idempotency verification | 15 | 15 | Idempotency-key-based deduplication proven at the real-PostgreSQL layer for transactions and payouts (including the `idempotencyKey`/`jobId` pair); webhook and dispute idempotency proven likewise. |
| Database constraint verification | 10 | 10 | Every relevant unique/partial-unique index and CHECK constraint confirmed live via `pg_indexes`/`pg_constraint` against the actually-migrated schema, then confirmed to fire under real concurrent load (not just to exist). |
| Webhook/payout concurrency | 10 | 10 | Webhook event idempotency, Stripe dispute uniqueness, and all three payout-duplication vectors (idempotency key, job id, partner in-flight) each independently raced and passed at all three concurrency levels. |
| Regression coverage | 10 | 4 | No new application-code defect was found, so no new regression test was owed (§17) — but this module could not confirm Module 91's *existing* 16-file regression suite actually executes end-to-end this session (§15), so full credit is not claimed here either. |
| Environment safety | 5 | 5 | Zero contact with any shared/production database; a definitively disposable instance was used throughout; no protection disabled; no credential exposure. |
| Documentation/evidence | 5 | 5 | Every claim in this report is backed by an exact command, exact error text, or exact query result reproduced above — no invented results, and the one environment blocker is documented with its precise root cause rather than a generic "could not run." |
| **Total** | **100** | **91** | |

---

## 23. Final Verdict

**VERIFIED WITH LOW FINDINGS**

Real, disposable PostgreSQL concurrency verification was successfully executed for every financial/webhook/reconciliation flow in scope, with 27/27 scenarios passing and every result independently confirmed against live database state — a first for this line of modules (91 → 94 → 96 → 104 → 109 → 111), none of which had previously had a genuinely reachable Postgres instance to test against. No real defect was found in the application or its schema. The one remaining gap — the existing Module 91 TypeScript suite's own execution being blocked by a narrow, precisely-diagnosed Prisma-engine network restriction, unrelated to database availability or to any code defect — is a low-severity, fully-documented environment limitation, not a correctness finding, and is why this verdict is `VERIFIED WITH LOW FINDINGS` rather than a plain `VERIFIED`.

---

### Final response summary

- **Environment used:** A freshly provisioned, disposable, local PostgreSQL 18.4 instance (`embedded-postgres` npm package, no Docker/root required), classified Class A per Phase 3, destroyed after each run. Never the shared Supabase database; never any `.env*` `DATABASE_URL`.
- **Real PostgreSQL concurrency executed:** **Yes** — 27 scenarios (financial idempotency, commission ledger, 3 payout-duplication vectors, webhook idempotency, Stripe dispute uniqueness, reconciliation discrepancy dedup, reconciliation cursor optimistic concurrency) × concurrency levels 2/5/10.
- **Pass/fail:** **27/27 PASS** (0 failures) after fixing one enum-value typo in this module's own disposable test harness (not application code).
- **Real defects found in application code:** **None.**
- **Code changes:** **None** — no `src/`, `prisma/`, or `.env*` file was modified.
- **Typecheck:** `npm run typecheck` — **exit 0, clean.**
- **Lint:** `npm run lint` — **exit 0, clean.**
- **Targeted mocked-suite regression check:** 58 files / 542 tests relevant to idempotency/payout/webhook/commission/reconciliation — **542/542 passed** (1 pre-existing, already-self-documented, non-blocking async Prisma-platform-mismatch warning, unrelated to test outcomes).
- **Environment blockers:** The Module 91 TypeScript real-DB suite (`npm run test:integration:db`) could not execute — `@prisma/client`'s Linux query/schema-engine binaries cannot be fetched because `binaries.prisma.sh` (and its S3 backend) is blocked by this workspace's network egress allowlist (confirmed via direct `curl`, `403` at the proxy). This is independent of, and narrower than, Module 104's prior "no Postgres reachable" finding — Postgres is now reachable; only this one binary-distribution path remains blocked.
- **Files changed:** `MaestroYa_Module_111_Real_PostgreSQL_Concurrency_Verification_Report.md` only.
- **Final score:** **91/100.**
- **Final verdict:** **VERIFIED WITH LOW FINDINGS.**
