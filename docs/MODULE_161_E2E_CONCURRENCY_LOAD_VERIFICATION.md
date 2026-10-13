# Module 161 — End-to-End, Concurrency & Load Verification

Status: implemented after M159 (Rollout Controls) and M160 (Observability & Runbooks), before Gate B and M162. **This module adds verification only. It does not enable LEAD_V1, does not pass Gate B, changes no production configuration, and makes no legal, security or capacity claim beyond what is demonstrated below.** No application source code was changed (no defect required a fix; see section 9).

## 1. Scope and architecture exercised

All M161 tests go through the **real composition roots** (`compose.ts` factories, including the outermost `LeadRolloutGuarded` wrapper), the real Prisma repositories, and the **real webhook route handler** (`POST /api/webhooks/stripe-payments`, real Stripe signature verification with a test secret). Only two ports are substituted: the Stripe lead-fee gateway (in-memory `FakeLeadFeePaymentGateway`, no network) and the e-mail sender (no-op). Flow covered:

request → M129 estimate → M128/M132 pricing → M133 publication snapshot + buyer policy → M134 feed → M126/M135/M147 purchase → M140 payment initiation → M141 webhook confirmation with M149 atomic ledger entry → M138 contact access → M150 invoice → M153 refund → M155 dispute/revocation → M158 consent/retention → M159 rollout guard.

Not exercised: HTTP server/Next.js rendering, Server Actions and sessions, real Stripe, real e-mail, CDN, browsers (Playwright e2e suite was not run, section 10).

## 2. Environment and reproducibility

| Item | Value |
|---|---|
| Database | Local disposable PostgreSQL 16.15 (Ubuntu package), loopback only, `max_connections=200`. URL never printed or recorded. |
| Safety guard | Existing `resolveTestDatabaseUrl()` (loopback / Docker host names only; managed providers such as Supabase refused). No production, Supabase or `.env` value was read or used. |
| Runtime | Node v22.22.0, linux/x64, **2 vCPU** cloud sandbox (app, test runner and PostgreSQL share the 2 vCPU). |
| Prisma | 6.19.3. |
| Isolation | `TRUNCATE ... CASCADE` per test (existing lifecycle helper). |

**Scratch environment (important).** The sandbox cannot download Prisma's native engines (HTTP 403) so the suites were run in a scratch copy of the repo **outside the user's repository**, with three scratch-only patches that are **not** part of this module: (a) `engineType = "client"` + `@prisma/adapter-pg` in the schema/client, (b) a `M161_SKIP_MIGRATE_DEPLOY` guard in the DB `global-setup.ts` (the migration SQL was applied to the disposable DB with `psql`), (c) a pool size (`max: 20`, `M161_POOL_MAX`). Consequence: **`prisma migrate deploy` itself and the production Prisma query engine were not exercised here**; on a machine with the normal engines the same tests run unchanged through `npm run test:integration:db`. The pool configuration of the scratch client (20) differs from the production client's default, so pool-pressure numbers are indicative only.

Reproduce (on a machine with a local disposable PostgreSQL and `TEST_DATABASE_URL` set to it):

```
npm run test:integration:db                       # includes the three M161 files
npm run test:load:m161                            # opt-in load profile (M161_LOAD=1)
```

## 3. Exact commands and outcomes

All run in the scratch environment above, against the disposable local PostgreSQL.

| Command | Outcome |
|---|---|
| Baseline, existing DB suite before M161 (`vitest run --config vitest.config.integration-db.ts`) | 38 files, **521/521 passed** |
| M161 E2E (`lead-v1-e2e-m161.test.ts`) | **7/7 passed** |
| M161 concurrency (`lead-v1-concurrency-m161.test.ts`) | **13/13 passed** |
| M161 rollout matrix (`lead-v1-rollout-matrix-m161.test.ts`) | **33/33 passed** |
| Full DB suite after M161 | **41 files passed + 1 skipped (the opt-in load file); 574 passed, 1 skipped** (521 + 53 new) |
| M161 load profile, run 1 and run 2 (`M161_LOAD=1`) | 1/1 passed each; 1,220 requests each, 0 unexpected errors, 0 timeouts, 0 invariant violations |
| Full unit/integration suite (`vitest run`, 782 files, fake-based, includes M121/M131/M126/M133/M159/M160 tests and the legacy-flow guard / isolation matrix) | 781 files / 8,562 tests passed; **1 failure**: `lead-lifecycle-boundary-contract.test.ts` could not read `docs/MODULE_130_STALE_LEAD_BACKFILL.sql` because that **untracked, protected local file is absent from the scratch copy**. After staging a read-only copy of the real file into the scratch copy the test passes (4/4). No code defect. |
| `tsc --noEmit` (scratch copy incl. new files) | Clean, no output |
| `eslint` on the new test files | Clean, no output |

`tsc` and `eslint` were run on the scratch copy (with the three scratch patches). Full-repository `eslint .` was not run (section 10). Mutation checks: two deliberate regressions to the rollout guard / matrix expectations were detected by the matrix, showing it is not vacuous.

## 4. E2E scenarios (`tests/integration-db/lead-v1-m161/lead-v1-e2e-m161.test.ts`)

1. Full happy path: submit → publish (pilot price 18.00, `maxBuyers: 1`, config `lead-pricing-pilot-v1`, policy `lead-buyer-policy-pilot-v1`) → feed shows no contact data → purchase (18.00 + 21 % IVA 3.78 = 21.78 → 2,178 minor units) → payment → forged and tampered webhooks rejected with 401 → signed webhook confirms → exactly 1 ledger entry → buyer sees contact, other professionals denied → duplicate event answered `duplicate`, replay `already-confirmed` → a second buyer is refused → invoice fails closed without issuer config, then is created once and is idempotent.
2. Failed and cancelled payments leave no contact and no ledger entry.
3. Wrong amount, wrong currency, foreign PaymentIntent and orphan events do not confirm.
4. Refund (M153) moves the purchase to REFUNDED.
5. Dispute through the route: created → DISPUTED, won → CONFIRMED, lost → REVOKED.
6. Admin revocation, idempotent.
7. Consent withdrawal with basis CONSENT: access ends, purchase stays CONFIRMED, no refund is issued.

## 5. Concurrency scenarios and invariants (`lead-v1-concurrency-m161.test.ts`)

Real contention is evidenced by a `pg_stat_activity` probe (`m161-contention-probe.ts`) that records peak active backends and peak lock waiters; races are not simply sequential.

| Scenario | Invariant verified |
|---|---|
| 12 concurrent buyers on a `maxBuyers: 1` lead | exactly 1 active purchase row; others get a domain refusal |
| 10 rounds × 6 racers | same, in every round |
| 10 concurrent requests, same professional, same lead | one shared `purchaseId`, one row |
| Unpaid slot held, then cancelled | slot blocks others while `PENDING_PAYMENT`, frees on cancel |
| 10 concurrent payment initiations for one purchase | 1 provider payment, 1 payment reference |
| Provider failure, then retry | retry succeeds, no orphan |
| Same event id × 10 | exactly one `confirmed`, the rest `duplicate` |
| 10 distinct event ids for one payment | 1 ledger entry; business notifications created once |
| Mixed succeeded / canceled / failed events (20 rounds) | consistent terminal state, never CONFIRMED and FAILED together |
| Out-of-order events | final state consistent |
| Purchase terminal mid-call | payment is cancelled, not left dangling |

The pilot buyer policy (`maxBuyers: 1`) was **not** changed or raised.

## 6. Webhook / payment idempotency and failure injection

* Claim key `(STRIPE_LEAD_FEE_PAYMENTS, event.id)` in `external_webhook_events`; concurrent duplicates hit the unique constraint (visible as handled `23505` log noise in load runs) and are answered `duplicate`.
* Confirmation is atomic with the M149 ledger entry; the ledger is append-only; `paymentReference` is write-once and unique.
* **Failure injection:** a Postgres trigger that raises on `lead_fee_ledger_entries` insert. Result: the webhook answers 5xx, the purchase stays `PENDING_PAYMENT`, no ledger row, the event is **re-claimable**; after removing the trigger, redelivery gives `confirmed`, a further delivery `duplicate`.

## 7. Rollout matrix and legacy boundary (`lead-v1-rollout-matrix-m161.test.ts`)

11 settings × three blocks (33 tests): unset, empty, `DISABLED`, `ENTRY_ONLY`, `PURCHASE_ONLY`, `ENABLED`, and fail-closed invalid values (`enabled`, ` ENABLED`, `true`, `1`, `ENABLED;DROP`). The expected table is hand-written, not derived from the implementation.

* New activity (submit / feed / purchase / payment initiation) is allowed or refused exactly per mode; **refusals create no rows and make no provider call**.
* Always-allowed operations stay allowed in every mode: signed webhook (and duplicate), contact access for existing buyers, checkout read, single preview, claim, dispute webhook, reconciler, revoke, refund, consent withdrawal, retention dry run, admin console.
* Legacy boundary (M121/M131): a legacy-shaped event without the `LEAD_V1` marker never confirms a lead purchase, and no `payments` / commissions / payouts / quotes rows are created by any LEAD_V1 operation. M121/M131 unit regressions (legacy-flow guard, isolation matrix, repository guards) pass in the full unit run.
* Mode is read per call, so an operator change takes effect without redeploying code, subject to how the environment variable is deployed (see M159 §4/§9; staging rehearsal not done).

## 8. Load profile and results

Harness: `tests/integration-db/lead-v1-m161/lead-v1-load-m161.test.ts`, opt-in (`M161_LOAD=1`, `npm run test:load:m161`), same DB guard, in-process through the real composition roots and the webhook handler, fixed profile and deterministic shuffling. Output JSON in git-ignored `reports/`. Asserts **only invariants and zero unexpected errors/timeouts — no latency threshold**.

**Limitations:** in-process (no HTTP, network, TLS, Next.js, sessions); in-memory payment gateway; 2 vCPU shared by client and database; tiny data volume; scratch client pool of 20; one machine; **two runs only**. These numbers are a baseline for this machine and **say nothing about production capacity**. No threshold (SLO) exists in the repository; deciding one needs product/operations input (section 12).

Profile: 40 professionals, 50 pre-published leads, 120 submissions, 25 exclusive leads × 8 contenders, 25 purchases paid, 5 webhook deliveries per payment, 300 rollout-guard refusals; 1,220 requests per run.

Run 1 / Run 2 (latency in ms; rps = requests per second; "peak active/lock" = peak simultaneously active backends / peak lock waiters seen by the probe):

| Scenario | n | conc. | ok / refused / err | rps | p50 | p95 | p99 | peak active / lock |
|---|---|---|---|---|---|---|---|---|
| S1 feed (read) | 400 | 20 | 400 / 0 / 0 | 103 / 87 | 186 / 229 | 244 / 286 | 294 / 326 | 2 / 0 |
| S2 submit (create + estimate + price + publish) | 120 | 10 | 120 / 0 / 0 | 36 / 39 | 278 / 252 | 329 / 307 | 340 / 346 | 5 / 0 ; 3 / 0 |
| S3 contended purchase (8 per exclusive lead) | 200 | 24 | 25 / 175 / 0 | 78 / 78 | 295 / 294 | 396 / 390 | 424 / 460 | 8 / 4 ; 3 / 3 |
| S4 payment initiation (3× per purchase) | 75 | 10 | 75 / 0 / 0 | 219 / 231 | 44 / 39 | 73 / 82 | 93 / 94 | 0 / 0 ; 1 / 0 |
| S5 signed webhooks (3 same id + 2 distinct) | 125 | 20 | 125 / 0 / 0 | 66 / 68 | 331 / 346 | 555 / 536 | 635 / 564 | 15 / 2 ; 16 / 2 |
| S6 guard refusals (DISABLED) | 300 | 20 | 0 / 300 / 0 | 9,162 / 10,366 | 1.3 / 0.8 | 1.8 / 2.8 | 2.2 / 3.0 | 0 / 0 |

Timeouts: 0 in both runs (per-operation limit 30 s). Invariant violations: 0 in both runs, checked after each scenario:

* exactly 1 active purchase per contended lead (25/25);
* 1 provider payment and 1 unique reference per purchase;
* 25 CONFIRMED purchases ↔ 25 ledger entries, no duplicated business notification;
* no contact data in any feed page, no page above the default page size;
* published leads = successful submissions, all carrying the pilot buyer policy;
* refused calls (S6) changed no request/lead/purchase row and made no provider call.

Observations (not conclusions): S1/S5 latencies are dominated by queueing — client and database compete for 2 vCPU and a 20-connection pool at concurrency 20–24, so the p50 of the read path is not representative of an uncontended request. Pool pressure was not measured against the production client's pool configuration. The S3 refusal ratio (175/200) is the expected outcome of 8 contenders per single-buyer lead, not an error.

## 9. Failures found and fixes

No production-code defect was found; one test-fixture defect was fixed (F-2). Findings:

* **F-1 (test-observability only, no fix):** an early expectation counted a label that includes non-confirmed attempts; corrected in the test. No product change.
* **F-2 (test fixture defect, fixed; found after first delivery):** on a developer machine, 52 of 53 M161 DB tests failed with `LeadNotPurchasableError` at `initiate-lead-purchase.use-case.ts:121` (`!candidate || !isProfessionalEligibleForRequest(candidate, visible)`), the feed was empty and the rollout matrix failed in every mode. **Root cause:** the fixture's `REQUEST_INPUT` supplied no coordinates, so `CreateLeadV1ServiceRequestUseCase` fell back to the *configured geocoding provider*. Geocoding is best-effort by design (`SafeGeocodingProvider` turns any failure into `null`) and the provider is chosen by `GEOCODING_PROVIDER`; the first scratch environment used the default network-free static geocoder, a developer environment that selects an API/network provider gets `null`, persists the request address with NULL coordinates, and `isProfessionalEligibleForRequest` returns `false` for every professional (`request.latitude === null`). Purchase, feed and matrix all share that one precondition, so they failed together; the concurrency algorithm was never reached. **Evidence:** forcing `GEOCODING_PROVIDER=OSM` in the scratch environment (no reachable geocoder) reproduced exactly 52 failed / 1 passed in 3 files with the same stack line; after the fix the same command gives 53/53. **Fix (fixtures only):** `REQUEST_INPUT` now passes explicit coordinates (the documented "explicit client coordinates win" rule), and `submitPublishedLead` fails with a precise message if the published request has no coordinates. No eligibility rule, assertion or expected outcome was changed, and no production code changed. After the fix: M161 DB files 53/53 and full DB suite 574 passed + 1 skipped under both the default and `GEOCODING_PROVIDER=OSM`; load profile 0 violations under `GEOCODING_PROVIDER=OSM`. **Limitation:** the failure was reproduced by simulation; the user's actual `GEOCODING_PROVIDER` value was deliberately not read (no `.env*` inspection) and the fix has not been run on that machine from here.
* **Design observations (documented, deliberately not changed):**
  * `maxBuyers` is **enforced in the application under a lead-row `FOR UPDATE` lock, not by a database constraint**; the database guarantees only the partial unique index per (lead, professional). The concurrency tests demonstrate the lock holds under the tested load (peak lock waiters up to 4); they do not prove behaviour for code paths that bypass the repository.
  * A `PENDING_PAYMENT` purchase **holds the buyer slot indefinitely** (no expiry, no operator release tool). With `maxBuyers: 1` an abandoned checkout blocks the lead. This is the M160 "stuck PENDING_PAYMENT" gap, confirmed in the repo docs; resolving it is a product/operations decision, not made here.

## 10. Tests not run and why

* `prisma migrate deploy` and the native Prisma query engine: blocked in the sandbox (engine download 403); migrations applied with `psql` instead (section 2).
* Playwright / browser e2e: no browser-driven flow, and it needs a running app; not in scope of the in-process verification.
* Real Stripe (test mode) and real e-mail: deliberately avoided (no external payment endpoints). Real signature verification was exercised with locally generated signed payloads.
* `eslint .` over the whole repository and `tsc` against the unpatched schema/client: only the new files were linted and the scratch copy type-checked.
* HTTP-level load, TLS, multi-instance behaviour, production-like data volume, soak and failover tests: not run.
* Staging kill-switch rehearsal: not performed (no staging environment used).

## 11. Remaining risks and infrastructure gaps

* No metrics backend or alerting (confirmed in M160 §12: "events are logs", no alert provider, Sentry rules not versioned).
* No expiry or monitor for `PENDING_PAYMENT` (M160 §12).
* Webhook/payment idempotency proven against PostgreSQL with a simulated provider only.
* The `maxBuyers` guarantee rests on application locking (section 9).
* Pool sizing and database capacity for production are unknown; no baseline from a production-like environment.
* Single-machine, 2-run measurement.

## 12. Outstanding legal and operational decisions

Carried forward, each re-checked against the repo docs (M153, M158, M159, M160) and **still open**; none is decided or implied by M161:

* **D19** — lawful basis for sharing contact details with buyers, plus notice text/versioning (M158 §open decisions; M159 Gate B checklist).
* **D20** — retention periods per data category (M158).
* **M153 / D12** — refund entitlement and execution policy (M153; M158 item 6; M160 checklist).
* **D21** — pilot cohort (region/professional) definition; per-region/professional rollout controls remain deferred (M159 §deferred, M160 checklist).
* **Staging kill-switch rehearsal** (M160 checklist) — not done.
* **Metrics and alerting** — absent (M160).
* **Stuck `PENDING_PAYMENT`** handling and an age threshold — absent; needs baseline data (M160).
* Also still listed in the M159/M160 Gate B checklist: D1, D14, D15, D16, D17, real issuer legal name/CIF configured, clean ledger/invoices/credit notes/reconciliation over a rehearsed period, operator runbook rehearsal.
* Latency/throughput objectives and a pool-size decision: product/operations.

## 13. Gate B readiness matrix

**Gate B is not approved by this document.** Technical evidence is separated from legal approval, operational readiness, business decisions and production authorization.

| Area | Item | Status | Evidence / note |
|---|---|---|---|
| Technical | E2E LEAD_V1 flow through real composition roots | PASS | 7/7, section 4 |
| Technical | maxBuyers = 1 under concurrency (real DB) | PASS | 13/13, probe shows real lock waits; section 5 |
| Technical | Webhook idempotency, duplicates, replay, out-of-order | PASS | section 5–6 |
| Technical | Failure injection (ledger insert failure) rolls back and is re-claimable | PASS | section 6 |
| Technical | Rollout modes + fail-closed config; refusals create nothing | PASS | 33/33, section 7 |
| Technical | Legacy boundary (M121/M131) preserved | PASS | matrix + unit suite; section 7 |
| Technical | Load baseline: invariants hold, 0 errors/timeouts | PASS (baseline only) | 2 runs, 1,220 requests each; section 8 |
| Technical | `prisma migrate deploy` + native engine verification | NOT VERIFIED | blocked in sandbox; section 2, 10 |
| Technical | Full-repo lint, Playwright e2e | NOT VERIFIED | section 10 |
| Technical | Production-like capacity, pool sizing, HTTP-level load | NOT VERIFIED | in-process, 2 vCPU; no threshold exists |
| Technical | DB-level enforcement of maxBuyers | FAIL (by design: application lock only) | section 9; accepted/changed only by a decision |
| Technical | Expiry / release of abandoned PENDING_PAYMENT | FAIL (not implemented) | section 9, M160 |
| Legal | D19, D20, M153/D12, D1, D14–D17 closed with advisor confirmation | NOT VERIFIED | open in docs |
| Operational | Staging kill-switch rehearsal | NOT VERIFIED | not performed |
| Operational | Metrics / alerting | FAIL (absent) | M160 §12 |
| Operational | Stuck-PENDING_PAYMENT detection and handling | FAIL (absent) | M160 §12 |
| Operational | Runbook rehearsal by operators | NOT VERIFIED | M160 checklist |
| Business | D21 pilot cohort; latency/capacity objectives | NOT VERIFIED | undecided |
| Business | Issuer legal name/CIF configured | NOT VERIFIED | M159/M160 checklist |
| Authorization | Explicit production authorization to enable LEAD_V1 | NOT GRANTED | out of scope of M161 |

## Files

Created: this document; `tests/test-utils/m161-lead-v1-world.ts`, `m161-lead-v1-flows.ts`, `m161-contention-probe.ts`; `tests/integration-db/lead-v1-m161/{lead-v1-e2e-m161,lead-v1-concurrency-m161,lead-v1-rollout-matrix-m161,lead-v1-load-m161}.test.ts`. Modified: `package.json` (adds `test:load:m161` script only). No application source, schema, migration, pricing, policy or payment-ownership change. (F-2 touched `m161-lead-v1-world.ts` and `m161-lead-v1-flows.ts` only.)
