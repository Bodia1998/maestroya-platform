# MaestroYa Post-Module-87/90 Production Readiness Audit
**Date:** 2026-09-01 · **Method:** Direct inspection of the repository at `/Users/bodia1998/projects/maestroya-platform-auth` (source, Prisma schema, migrations, tests, CI, env config). Prior `MODULE_*_IMPLEMENTATION_REPORT.md` files and prior audit `.md` files in the repo root were **not** trusted as evidence — every claim below is backed by a file path I actually read.

**Honesty note on depth.** This repo is large — 1,147 files under `src/core` alone, an 88-model / 226KB Prisma schema, 64 integration-test files. A single audit pass cannot forensically read every line. I went deep (full file reads, schema diffs, migration SQL) on the areas with the highest financial/legal/security stakes: the Stripe payment/dispute/webhook path, the reconciliation engine, the fraud/trust provider layer, GDPR erasure, the env/config boundary, and the testing strategy. Other areas (full route-by-route authz inventory, every Persona state transition, every cron job) were verified structurally (file existence, wiring, key function signatures) rather than line-by-line. Where my confidence is "structural" rather than "verified in full," I say so.

---

## Executive Summary

This is a genuinely well-architected codebase, not a typical AI-generated shell. It has real Clean Architecture boundaries (`domain` / `application` / `infrastructure` / `presentation`), a single validated env boundary (`src/core/infrastructure/config/env.ts`, ~970 lines, Zod-validated, fails fast), append-only financial ledgering with DB-enforced idempotency, a `Payout.jobId @unique` constraint that makes double-payout impossible at the database level (not just application logic), and unusually thorough doc-comments that explain *why*, not just *what*. The Stripe payment and dispute webhook paths are correctly separated (Connect events vs. platform payment events), both verify raw-body HMAC signatures before parsing, and both claim `(provider, event.id)` idempotency before any processing.

That said, three concrete, verified gaps stand between this repo and genuine production readiness for real money:

1. **The fraud/trust system (Module 89) has no real anti-fraud signal for its three highest-value detectors.** `createDeviceFingerprintProvider`, `createVpnProxyDetectionProvider`, and `createPhoneReputationProvider` all resolve to `Null*Provider` stub classes (`src/core/infrastructure/trust-integrity/trust-integrity-provider-factory.ts`). Only disposable-email (a static list) and off-platform-contact detection (a regex/keyword rule) produce real signal. This is architecturally sound (clean ports/adapters, swappable) but functionally means device fingerprinting, VPN/proxy detection, and phone reputation contribute nothing today.
2. **Zero integration tests exercise a real PostgreSQL database.** CI (`.github/workflows/ci.yml`) spins up a real `postgres:16-alpine` service and runs `prisma migrate deploy` against it — but I confirmed **0 of 64** files under `tests/integration` import the real Prisma client; all use in-memory fakes. The Postgres service in CI validates migrations only, never business logic, meaning every database-level invariant this report praises above (unique constraints, cascades, partial indexes) is *never actually exercised by the test suite*.
3. **The reconciliation engine does not sweep the full ledger over time.** The scheduled cron (`vercel.json` → `/api/cron/reconciliation-run`, every 6h) calls `StartReconciliationRunUseCase.execute({ scope, limit }, null)` with `since` always `null`. `PrismaReconciliationDataSource.listJobIdsToInspect` returns at most `RECONCILIATION_SCHEDULE_LIMIT` (default 500) **most-recently-active** jobs. There is no advancing window — every run re-scans roughly the same recent slice. Jobs that fall out of the "most recent 500" are never automatically reconciled again. The engine's own doc comments concede this is "an operational... not implemented-here concern."

None of these three are exotic; all three are fixable without new architecture. Alongside them, this audit found a real but non-blocking gap in GDPR document-purge retry (no scheduled retry of a failed Cloudinary purge — only re-triggered by a fresh erasure call) and confirmed the payments/Connect/dispute/invoicing/credit-note chain is implemented, wired, and reachable end-to-end.

---

## Current Production Readiness Score

| Category | Weight | Score | Notes |
|---|---|---|---|
| Architecture | 15 | 13/15 | Clean layering genuinely respected; ports/adapters used correctly (Stripe, Persona, geocoding, search all swappable via env). Minor deduction: some cross-cutting concerns (rate limiting) route through an `AntiAbuseService` I confirmed exists and is wired into `security/compose.ts`, but I did not verify every money-moving Server Action calls it. |
| Business Logic | 15 | 12/15 | Commission, invoicing, credit-note, dispute-resolution logic all present and cross-referenced correctly (e.g., refund → automatic credit note via `create-credit-note-on-payment-refunded.subscriber.ts`). Deduction for the reconciliation coverage gap (#3 above) — a business-logic-level correctness issue, not just an infra gap. |
| Payments & Stripe | 20 | 16/20 | PaymentIntent → webhook → commission → payout → refund → dispute → reversal chain is real, idempotent at the DB layer (`Transaction.idempotencyKey @unique`, `Payout.jobId @unique`, `Payout.idempotencyKey @unique`, `Payout.reversalIdempotencyKey @unique`), and dispute handling (`charge.dispute.created/updated/closed`) is wired into the same webhook route as payment capture. Deduction for: no independent verification I performed of Stripe Connect account-status sync under negative-balance/restricted-account edge cases (structural only), and the reconciliation gap above directly weakens payment correctness assurance. |
| Security | 15 | 11/15 | Env secrets are centralized and typed; webhook routes verify signatures on raw bytes before parsing (correct — I read the actual code, not just doc comments); cron routes require `Authorization: Bearer $CRON_SECRET` and fail closed (503) if unset rather than skipping the check. Deduction: I could not confirm systematically that every privileged Server Action (not just API routes — this app is Server-Action-heavy, only 16 `route.ts` files exist) enforces rate limiting; this needs a dedicated pass, not assumed either way. |
| Database & Data Integrity | 10 | 8/10 | Decimal(10,2) for all money fields (not float), `onDelete: Restrict` on every financial FK I sampled (Payment, Commission, Payout, Transaction — cascading deletes cannot silently destroy financial history), a real partial unique index (`reconciliation_discrepancies_open_fingerprint_unique ... WHERE resolutionStatus = 'OPEN'`) enforced via raw SQL migration for discrepancy dedup. Deduction: these invariants are asserted by schema/migration inspection only — never exercised by the test suite (see Testing). |
| Testing | 10 | 4/10 | Test suite is large (64 integration files, plus unit/e2e) and CI runs it against a real Postgres for migrations — but the business-logic tests themselves are 100% in-memory-fake-backed. This is the single largest, most concrete gap in this audit. |
| Observability & Operations | 5 | 4/5 | Sentry, OpenTelemetry tracing, structured logger, `/api/health/*` (ready/startup/circuit-breakers/diagnostics) all present and wired. Not independently verified: alert routing/on-call for a 3am financial failure (structural only). |
| Scalability | 5 | 4/5 | Read-replica support, Redis-backed cache/lock/rate-limit with in-memory fallback, circuit breakers — all present in `env.ts` and have factories. Structural verification only; not load-tested by me. |
| GDPR / Compliance | 5 | 4/5 | Genuinely thoughtful per-category erasure classification (hard-delete/anonymize/retain with stated legal rationale), retryable Cloudinary purge with failure tracking. Deduction: no scheduled retry of failed purges — relies on someone re-triggering erasure. |

**CURRENT SCORE: 76 / 100**

**REALISTIC SCORE AFTER FIXING IDENTIFIED GAPS: 90 / 100** — reachable via three targeted modules (real-DB test harness, real fraud-signal providers, a genuinely advancing reconciliation window), not a rewrite.

---

## 1–17. Detailed Audit Findings by Area

*(Consolidated below rather than as 17 separate long sections, since most of the granular findings collapse into the same handful of root causes. Section numbers from your brief are cited inline.)*

### Financial / Payment Lifecycle (§2)
Traced: Quote acceptance → `Payment` (status `PENDING`→captured, `stripePaymentIntentId @unique`) → `stripe-payments` webhook (`payment_intent.succeeded/failed/canceled`, `charge.refunded`, plus `charge.dispute.*`) → `Commission` (`paymentId @unique`, `rateBps`, `Decimal(10,2)`) → `Payout` (per-job, `jobId @unique` + `idempotencyKey @unique` reused as the literal Stripe `Idempotency-Key` header) → `Refund`/dispute reversal (`stripeReversalId @unique`, `reversalIdempotencyKey @unique`) → `Invoice`/`CreditNote` (auto-created on refund via event subscriber) → `Transaction` ledger (append-only, `idempotencyKey @unique`, no update/delete method exposed by the repository interface).

Verified answers to your specific failure-mode questions: a **duplicate webhook delivery** is caught by `(provider, event.id)` idempotency claims before any processing (confirmed by reading both webhook route handlers' doc comments and matching code — this isn't just asserted, the route literally reads raw body → verify signature → claim event → process, in that order). A **double payout** is prevented at the database level by `Payout.jobId @unique`, not merely by an application-level check — so even a race between two workers cannot create two successful payouts for one job (the second insert fails the constraint). **Money duplication via retry** is prevented the same way the `Transaction.idempotencyKey @unique` constraint plus reused Stripe idempotency keys on `transfers.create`.

What I did **not** verify line-by-line: the exact behavior when Stripe succeeds but the DB write fails mid-transaction (crash-safety of the specific Prisma transaction boundaries in `ExecuteProfessionalPayoutUseCase`) — the doc comments assert retry-safety via reused idempotency keys, which is the right design, but I did not trace every intermediate DB write.

### Stripe Integration (§3)
Two separate webhook endpoints by design, not accident: `/api/webhooks/stripe` (Connect account events, `account.updated`, subscribed with `connect: true`) and `/api/webhooks/stripe-payments` (platform payment events: `payment_intent.amount_capturable_updated/succeeded/payment_failed/canceled`, `charge.refunded`, `charge.dispute.created/updated/closed`). Both verify HMAC signature over the raw byte body before any parsing — confirmed by reading the actual route code, not just the doc comment. `charge.dispute.funds_withdrawn`/`funds_reinstated` are deliberately not subscribed (documented rationale: they mirror information already available from `created`/`closed`). This is a reasonable, defensible scope — I did not find evidence it's a real gap.

Stripe Connect: `stripe-connect-gateway.ts`, `stripe-connect-webhook-verifier.ts`, `stripe-transfer-gateway.ts`, and a `StripeDisputeSystemUserId` env var for attributing dispute-driven system actions to an audit-log actor all exist. I did not independently trace negative-balance or account-restriction handling end-to-end (structural confirmation only — the account-state migration `20260902000000_add_stripe_connect_account_state` exists, suggesting this was deliberately modeled).

### Persona Verification (§4)
Confirmed genuinely integrated, not a stub: `persona-client.ts`, `persona-verification-provider.ts`, `process-persona-webhook.use-case.ts`, and a working webhook route that verifies signature/timestamp before parsing (same "thin route handler" pattern as Stripe). Selected via `VERIFICATION_PROVIDER=persona|manual` (defaults to `manual` via `.catch()` — safe default, no accidental real API calls). Env vars actually present in `env.ts` (all optional, consumed only when `VERIFICATION_PROVIDER=persona`): `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`, `PERSONA_API_BASE_URL`. I did not trace every inquiry state transition (approved/declined/expired/retry) line-by-line — structural confirmation only.

### External Services / Full Env Var Inventory (§5–6)
Built directly from `env.ts`'s Zod schema (the single source of truth this codebase enforces — nothing reads `process.env` elsewhere by convention). No Firebase, no OpenAI/Gemini/Anthropic, no SMS vendor beyond an optional Twilio integration — I grep'd the entire `src` tree for these terms and found zero references outside this schema.

| Integration | Env Var(s) | Required? | Notes |
|---|---|---|---|
| Postgres | `DATABASE_URL` | Required always | No separate `DIRECT_URL`/pooling var — worth deciding deliberately for serverless (Vercel + Prisma commonly needs PgBouncer/Accelerate); not present today. |
| Read replicas | `READ_REPLICAS_ENABLED`, `DATABASE_REPLICA_URLS`, `READ_REPLICA_*` (7 tuning vars) | Optional | Defaults to disabled; safe. |
| Auth.js | `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID/SECRET`, `AUTH_APPLE_ID/SECRET`, `AUTH_FACEBOOK_ID/SECRET` | Secret/URL required; OAuth optional | |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENTS_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID` (optional), `STRIPE_DISPUTE_SYSTEM_USER_ID` (optional, UUID) | Required (first 4) | Two separate webhook secrets — correct, matches the two-route design. |
| Persona | `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`, `PERSONA_API_BASE_URL` | All optional | Only consumed when `VERIFICATION_PROVIDER=persona`. |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required always | Used for verification-document storage and GDPR purge. |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | Required always | |
| SMS | `SMS_PROVIDER` (mock/twilio), `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` | Optional, defaults to mock | |
| Redis | `REDIS_URL` | Optional | Every Redis-backed service (cache, rate-limit, lock) has a correct in-memory fallback — confirmed in code comments and factory pattern. |
| Geocoding | `GEOCODING_PROVIDER` (defaults STATIC via `.catch`), `MAPBOX_API_KEY`, `GOOGLE_GEOCODING_API_KEY`, `HERE_API_KEY` | Optional | Cannot silently call a real geocoding API — invalid/missing config always resolves to the network-free static provider. |
| Search | `SEARCH_PROVIDER` (none/meilisearch/typesense), `MEILISEARCH_HOST/API_KEY`, `TYPESENSE_HOST/API_KEY`, `SEARCH_INDEX_PREFIX`, `SEARCH_INDEXING_ENABLED`, `SEARCH_INDEX_BATCH_SIZE` | Optional | |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | Required in real production (enforced via `superRefine` when `NODE_ENV=production` outside Next's build phase) | |
| Tracing | `TRACING_ENABLED`, `TRACING_EXPORTER`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_HEADERS` | Optional | |
| Cron auth | `CRON_SECRET` | Optional but **fails closed** — routes return 503 rather than skip auth if unset | |
| Backups | `BACKUP_ENABLED`, `BACKUP_STORAGE_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_MIN_RETAINED_BACKUPS`, `BACKUP_FULL_INTERVAL_DAYS`, `BACKUP_SCHEDULE_CRON` | Optional, default disabled | |
| Reconciliation | `RECONCILIATION_AUTOMATION_ENABLED`, `RECONCILIATION_SCHEDULE_CRON`, `RECONCILIATION_SCHEDULE_LIMIT` (default 500) | Optional | See finding #3 above — this is the knob that caps the scan window. |
| Feature flags | `FEATURE_FLAGS_ENABLED`, `FEATURE_FLAGS_CONFIG` | Optional | |

No `NEXT_PUBLIC_*` variable was found holding anything that reads as a secret except `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_APP_URL`, both of which are meant to be public (Sentry DSNs and app URLs are not secrets by design).

### Database Audit (§7)
Sampled `Payment`, `Commission`, `Payout`, `Transaction`, `ReconciliationDiscrepancy` in full. All monetary fields are `Decimal(10,2)`, never float. Every financial foreign key I checked uses `onDelete: Restrict`, meaning a user or job cannot be deleted out from under a financial record — the GDPR erasure flow correctly anonymizes/retains rather than hard-deleting `MARKETPLACE_FINANCIAL`. The reconciliation dedup constraint (`reconciliation_discrepancies_open_fingerprint_unique ... WHERE "resolutionStatus" = 'OPEN'`) is a real partial unique index applied via raw SQL in `prisma/migrations/20260907000000_add_financial_reconciliation_module/migration.sql` — Prisma's declarative schema syntax doesn't natively express partial indexes, so this correctly lives in migration SQL, but note this means `schema.prisma` itself only shows a plain `@@index([fingerprint])`, not the actual DB guarantee — a schema-only reviewer would miss it. I did not audit all 88 models; this is a sample of the financially critical ones.

### GDPR / Retention (§8)
`gdpr-privacy-rules.ts` classifies all 12 data categories with stated legal rationale (Art. 17(3) exceptions cited correctly for retained categories: disputes, audit log, consent records, financial). `execute-account-erasure.use-case.ts` is idempotent by design (safe to re-run after a crash), clears `passwordHash`, revokes refresh tokens and NextAuth sessions, and purges verification documents from Cloudinary with per-document failure tracking (reported via `FailureReporter`, not swallowed). **Gap confirmed:** nothing schedules a retry of a failed Cloudinary purge — `documentsStoragePurgeFailures` is surfaced in the event/result but no cron re-invokes `execute()` for accounts with outstanding failures. A user whose Cloudinary purge fails once will have their document metadata marked deleted in the DB but the actual file may persist indefinitely unless someone manually re-triggers deletion. Also noted honestly by the code itself: JWT session cookies are not server-revocable and remain valid up to 30 days after erasure for non-admin-tier requests — this is disclosed in the doc comment, not hidden, and is a reasonable, documented trade-off rather than an oversight.

### Security (§9)
Env/secrets centralization is real and enforced via the `server-only` package (not just a runtime check — enforced at the Next.js bundler/webpack level, with an explained rationale for why a `typeof window` check was tried and reverted). Webhook and cron routes fail closed. I did not complete a full route-by-route IDOR/authz inventory (structural spot-check only, not exhaustive) — recommend this as a dedicated follow-up if not already covered by Module 82's RBAC hardening (which I did not independently re-verify beyond confirming the relevant files exist).

### Fraud / Trust (§10) — **key finding**
`trust-integrity-provider-factory.ts` is the single composition point for five ports. Two resolve to real, if simple, implementations: `StaticListDisposableEmailProvider` and `RuleBasedOffPlatformDetectionProvider`. Three resolve to `Null*Provider` stubs: device fingerprinting, VPN/proxy detection, phone reputation. This is not hidden — the factory's own doc comment says "no external SDK is integrated, per the module brief" — but it means any risk score that weights those three signals is being fed a constant/no-signal input in production today, which could produce false confidence (a fraud score that looks "clean" partly because two of its five inputs never say anything else).

### Reconciliation (§11) — **key finding**
`StartReconciliationRunUseCase` is safe to invoke concurrently (fresh `ReconciliationRun` row per call, discrepancies deduplicated by the fingerprint partial-unique-index above — confirmed, not just asserted). But the cron route never passes a `since` value, and `RECONCILIATION_SCHEDULE_LIMIT` defaults to 500 "most-recently-active first." This means the automated 6-hourly run is a fixed recent window, not a sweep that advances through the full ledger. The engine's own code comments explicitly document this as "an operational... concern" left to "existing job/cron infrastructure, not implemented by this class." In practice: **once a platform has more than ~500 active jobs, or once older jobs age out of "recently active," they stop being automatically reconciled.**

### Observability / Cron / CI-CD / Testing (§12–15)
Sentry + OpenTelemetry + structured logger + a `/api/health/*` family (ready/startup/circuit-breakers/diagnostics) are all present and wired, not aspirational. `vercel.json` schedules two crons (`expire-workflows` daily, `reconciliation-run` every 6h); both routes require `CRON_SECRET` and fail closed if unset. `.github/workflows/ci.yml` runs typecheck, lint, `prisma validate`, `prisma migrate deploy` + `migrate status` against a real ephemeral Postgres, unit tests, integration tests, and a production build — but **has no deployment step** (no `vercel deploy`, no Docker push) — deploy is presumably manual/Vercel-Git-integration-driven, which I could not verify from the repo alone.

**Testing — the single largest confirmed gap:** I grep'd all 64 files under `tests/integration` for real Prisma client imports (`from "@/infrastructure/database/prisma/client"`): zero matches. All reference in-memory/fake repositories (79 `InMemory`/`Fake` occurrences). CI's real Postgres service is exercised only by `prisma migrate deploy`/`migrate status`, never by a single application test. This means every database-level invariant this report verified by reading schema/migrations (unique constraints, cascade `Restrict`, the partial index) is asserted correct by inspection, but **never asserted correct by a passing/failing test**. A future migration could silently drop the `Payout.jobId @unique` constraint and no test would catch it.

### Dead / Disconnected Functionality (§17)
I ran a targeted sweep for `TODO`/`FIXME`/"not implemented"/"never called" across `src/core`. Two hits initially looked like dead code but on inspection were the opposite: `create-credit-note-on-payment-refunded.subscriber.ts`'s comment ("never called from anywhere" — Module 79) describes the *pre*-Module-85 state that this very subscriber resolves by wiring `CreateCreditNoteUseCase` to the `PaymentRefunded` event; it is now reachable. I found no genuinely dead, unwired financial/security/GDPR code path in this pass. The `Null*` fraud providers (see above) are wired and reachable — they just don't produce real signal, which is a different problem than "disconnected."

---

## Production Blockers

**🔴 BLOCKERS — fix before handling real customers / real money**
- None of the three findings above are, strictly, "money can be duplicated or lost today" bugs — the DB-level constraints prevent that class of error even without perfect test coverage or perfect fraud signal. I did not find a blocker in the sense of "will lose money on day one." The closest to a blocker is the testing gap: shipping further changes without real-DB tests risks silently breaking the very invariants that make the payment path safe.

**🟠 HIGH PRIORITY — fix before serious scale**
- Real-DB integration test harness (testcontainers or equivalent) covering financial invariants, concurrency, and cascade behavior.
- Reconciliation engine needs an advancing `since` window (or a full-sweep mode) so the ledger is actually covered over time, not just the most recent ~500 active jobs.
- Real device-fingerprint, VPN/proxy, and phone-reputation providers (or a documented, deliberate decision to launch without them and compensate with manual review thresholds).
- Scheduled retry for GDPR document-purge failures.
- Confirm DB connection pooling story for serverless deployment (no `DIRECT_URL`/pooler var currently modeled).

**🟡 POST-LAUNCH**
- Full route/Server-Action-level rate-limiting and IDOR audit (I found the infrastructure; did not exhaustively verify every call site).
- CI deploy-step automation, if not already handled by Vercel's Git integration outside this repo.

---

## Required Future Modules

**Module A — Real-Database Integration Test Harness.** Gap: 0/64 integration tests hit Postgres. Files: `vitest.config.ts`, `tests/integration/**`, `tests/test-utils/`. Business impact: none directly, but removes the safety net for every financial invariant. Complexity: medium (testcontainers + a `DATABASE_URL` fixture + rewriting a representative slice of tests, not all 64 at once). Priority: highest. Not a launch blocker, but should precede any further schema changes.

**Module B — Reconciliation Full-Ledger Coverage.** Gap: fixed 500-job recent window, no advancing `since`. Files: `start-reconciliation-run.use-case.ts`, `prisma-reconciliation-data-source.ts`, `api/cron/reconciliation-run/route.ts`, `env.ts`'s `RECONCILIATION_SCHEDULE_*`. Complexity: low-medium (persist last-scanned cursor, advance it per run). Priority: high, financial-integrity-adjacent.

**Module C — Real Fraud/Trust Signal Providers.** Gap: 3 of 5 trust-integrity providers are no-op stubs. Files: `trust-integrity-provider-factory.ts` and its three `Null*` implementations. Complexity: medium (vendor integration + new env vars, same pattern as Persona). Priority: high if fraud losses are a real concern at current volume; otherwise medium.

**Module D — GDPR Purge Retry Job.** Gap: no scheduled retry of a failed Cloudinary document purge. Files: `execute-account-erasure.use-case.ts`, a new cron alongside `expire-workflows`/`reconciliation-run`. Complexity: low. Priority: medium (compliance, not financial).

## Recommended Module Order
```
Module A (test harness)
   ↓ (gives every later change a safety net)
Module B (reconciliation coverage)  +  Module D (GDPR retry)
   ↓
Module C (real fraud providers)
```
Order matters because Module A is the only one that changes how confidently every other module can be verified once built — building B/C/D first without A means their own correctness is, again, asserted by inspection rather than tested.

---

## Credential / Manual Setup Checklist

Only variables this repository actually reads (per `env.ts`) are listed.

**Stripe** — Dashboard → Developers → API keys / Webhooks / Connect: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (test values available; safe for local dev), `STRIPE_WEBHOOK_SECRET` (from the `/api/webhooks/stripe` endpoint's signing secret), `STRIPE_PAYMENTS_WEBHOOK_SECRET` (from the separate `/api/webhooks/stripe-payments` endpoint — these are two different Dashboard webhook endpoints and two different secrets), `STRIPE_CONNECT_CLIENT_ID` (optional, Connect settings), `STRIPE_DISPUTE_SYSTEM_USER_ID` (optional, an internal admin user UUID, not a Stripe credential).

**Persona** (only if `VERIFICATION_PROVIDER=persona`) — `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`, `PERSONA_API_BASE_URL` (optional override).

**Cloudinary** — `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — required in every environment, including local dev (no dev-only fallback).

**Resend** — `RESEND_API_KEY`, `EMAIL_FROM` — required always.

**Sentry** — `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` — optional in dev/test, enforced-required in real production.

**Redis** — `REDIS_URL` — fully optional; every consumer has a safe in-memory fallback for single-instance/dev use.

**PostgreSQL** — `DATABASE_URL` — required always. No pooling variable exists today; decide this before scaling serverless deployment.

**SMS** — `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER`, only if `SMS_PROVIDER=twilio` (defaults to a mock provider).

**Maps/Geocoding** — one of `MAPBOX_API_KEY` / `GOOGLE_GEOCODING_API_KEY` / `HERE_API_KEY`, only if `GEOCODING_PROVIDER` is explicitly set to that value; otherwise a static, network-free provider is used.

**Not present in this repo, and not required:** Firebase, OpenAI/Gemini/any AI provider — none referenced anywhere in `src`.

---

## Final Recommendation

MaestroYa is closer to production-ready than the module-count alone suggests, because the parts that would be catastrophic to get wrong — money duplication, double payout, cascading deletion of financial history, unsigned webhooks — are protected at the database and signature-verification level, not just by application code that could be bypassed by a bug. The remaining gap to a genuine 90+ is concentrated, not diffuse: give the test suite a real database, give reconciliation a real sweep, and either build or consciously accept the absence of real fraud-detection signal. None of that requires re-architecting anything already built.
