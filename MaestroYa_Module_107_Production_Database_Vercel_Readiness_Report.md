# MaestroYa — Module 107: Production Database & Vercel Infrastructure Readiness

**Branch:** `feature/module-107-production-database-vercel-readiness`
**Date:** 2026-09-13
**Auditor role:** Principal Infrastructure Engineer / Senior DevOps Engineer / Production Reliability Engineer
**Scope:** Audit only, as authorized by the module brief — no redesign, no ORM/proxy swap, no business-logic change.

---

## 1. Executive Summary

Module 107 audited the Vercel → Next.js → Prisma → Supabase PostgreSQL path for production readiness: Prisma Client lifecycle, connection-pooling architecture, transaction safety, migration strategy, Vercel runtime compatibility, cron/webhook concurrency, and observability.

**Finding: the application-layer architecture is sound.** Prisma Client is a correctly-implemented `globalThis` singleton (one instance per server process, hot-reload-safe); all four cron routes use shared-secret bearer auth with timing-safe comparison and a `DistributedLock`-backed use case layer that makes duplicate/overlapping invocations safe; all inspected financial `$transaction` blocks (invoices, payouts, affiliate commissions, self-billing, credit notes) contain only database operations — no external network calls (Stripe, Cloudinary) execute while a DB transaction is held; all three webhook routes (`stripe`, `stripe-payments`, `persona`) follow a documented signature-verify → idempotency-check → use-case pattern; migrations are deliberately **not** run from the Docker entrypoint (avoiding multi-replica migration races), and the sanctioned production path (`prisma migrate deploy`, run as a single explicit step before rollout) is documented in `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md`.

**The one open item is a database-connection-string architecture question, and it is not a code defect.** `DATABASE_URL` points at Supabase's Supavisor pooler in **session mode** (`aws-0-eu-west-1.pooler.supabase.com:5432`) with no `DIRECT_URL`/`directUrl` configured and no `connection_limit`/`pgbouncer` query parameters — the same single URL is used for application queries, migrations, seeding, and admin scripts. Session mode is a *safe* choice (it supports prepared statements and interactive transactions natively, unlike transaction-mode pgbouncer), but it does not multiplex connections the way transaction mode does, so its effective capacity under many concurrent Vercel serverless invocations depends entirely on the pool-size and plan tier configured in the Supabase dashboard — data this audit cannot see from the repository. This is exactly the Module 105 finding, and it remains **PARTIALLY RESOLVED**: the repository-visible risk (an unbounded, per-request `new PrismaClient()`) is confirmed absent, but the external pooler capacity itself cannot be confirmed from code.

Per the module's explicit **File Safety** rule, `.env`, `.env.local`, `.env.production`, and `.env.test` may not be modified in this module — and the only concrete adjustment this finding would motivate (adding `DIRECT_URL`/`connection_limit` query parameters) lives entirely inside those files. There is therefore no in-repository code change this audit can make that would resolve it; the fix, if adopted, is an external Supabase/Vercel dashboard and environment-variable action, not a source change. Accordingly:

**Decision: OPTION A — no code change required.** The audit is verification-only. See §17–19 for the full finding and §18 for the specific external action recommended (informational, not implemented).

---

## 2. Audit Scope

In scope: Prisma Client lifecycle, `DATABASE_URL`/`DIRECT_URL` architecture, Supabase pooling mode, connection-exhaustion patterns, transaction safety on financial paths, migration deployment strategy, Vercel runtime/build compatibility, cron infrastructure, webhook infrastructure, concurrency protection, and observability of database failures.

Out of scope (per module brief): replacing Supabase, replacing Prisma, introducing another ORM or a database proxy, rewriting repositories or architecture, introducing a DI container, changing business/tax/commission logic, changing authentication, changing Cloudinary architecture, or modifying unrelated modules. No destructive database operations were run. No `.env*` file was modified. `legal/` was not touched.

---

## 3. Repository Baseline

- Branch: `feature/module-107-production-database-vercel-readiness` (confirmed via `git branch --show-current`).
- HEAD at audit start: `8a6d0d1` — "Merge pull request #117 from Bodia1998/feature/module-106-secure-cloudinary-document-delivery".
- `git status` at audit start: clean except the pre-existing untracked `legal/` directory (left untouched throughout, per instructions).
- `package.json`: Next.js `15.1.0`, `@prisma/client`/`prisma` `^6.1.0` (installed: **6.19.3**, confirmed via `node_modules/@prisma/client/package.json`), PostgreSQL client target `postgres:16-alpine` (CI service and `docker-compose.yml`), Node `>=20.0.0` (`.nvmrc` pins `20`).
- `prisma/schema.prisma`: single `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` — no `directUrl` field present anywhere in the schema. `generator client { provider = "prisma-client-js" }` — no `binaryTargets` override (defaults to the platform Prisma generates on, i.e. whatever runs `prisma generate`).
- `prisma/migrations/`: 65 entries (64 migration directories + `migration_lock.toml`), consistent with the module brief's reported `npx prisma migrate status` result of "64 migrations found."
- Vercel: `vercel.json` defines four `crons` entries (`expire-workflows` daily 03:00 UTC, `reconciliation-run` every 6h, `gdpr-cloudinary-purge` every 30 min, `referral-affiliate-maintenance` daily 04:00 UTC). No `functions`/`maxDuration` overrides found in `vercel.json` or in any route file (`export const runtime` / `maxDuration` grep returned no matches) — every route runs under Vercel's platform default duration for its plan.
- `next.config.ts`: `output: "standalone"` — this is present for the **Docker** deployment path (`Dockerfile` copies `.next/standalone`); it does not break a Vercel deployment (Vercel's own builder handles `output: "standalone"` correctly and does not require it), but it is a signal that this repository was built to be deployable to *either* target, not exclusively Vercel-shaped.
- Docker: `Dockerfile` and `docker-compose.prod.yml`/`docker-compose.yml` present. The `Dockerfile`'s own comment block is explicit: migrations are **deliberately not run from the container entrypoint** ("multiple replicas starting concurrently must never race to apply the same migration") — a correct and production-safe design choice, and one that transfers directly to the Vercel case (a Vercel deploy building N regional/edge instances must equally never have each instance race to apply migrations).
- CI/CD: `.github/workflows/ci.yml` runs `prisma generate` → `typecheck` → `lint` → `prisma validate` → `prisma migrate deploy` (against the CI's own ephemeral `postgres:16-alpine` service) → `prisma migrate status` → unit tests → integration tests → real-DB integration tests (Module 91 harness) → `next build`. This pipeline validates the migration/build path on every PR but **does not deploy migrations to the production Supabase database** — no workflow in this repository targets the production database. Production migration deployment is documented (see §10) as a manual, explicit, single-runner operational step, not something CI or the container does automatically.

Previous module reports reviewed (read-only, not modified): `MaestroYa_Module_100_Affiliate_Accumulated_Balance_Report.md`, `MaestroYa_Module_103_IDOR_Authorization_Audit.md`, `MaestroYa_Module_104_Full_Test_Suite_Verification.md`, `MaestroYa_Module_105_Production_Environment_API_Audit.md`, `MaestroYa_Module_106_Secure_Cloudinary_Document_Delivery_Report.md`, plus `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md` for the deployment/migration runbook.

---

## 4. Previous Findings Rechecked

- **Module 105 (Medium): "database connection-pooling strategy for the actual Vercel deployment target could not be confirmed from the repository alone."** Rechecked in full (§7–8 below). Confirmed still accurate: the repository shows a single pooled `DATABASE_URL` (Supabase Supavisor, session mode) used everywhere, a correct singleton Prisma Client, and no per-request client creation — but the actual Supabase project's pool-size/plan tier and Vercel's configured concurrency ceiling are external dashboard settings, invisible to a repository audit. **Status: PARTIALLY RESOLVED** (see §17).
- **Module 104: Prisma client generated for `darwin-arm64`, sandbox runtime `linux-arm64`.** Rechecked directly: this audit's own attempt to run `npx prisma migrate status` from this session's local-device shell (a sandboxed Linux `aarch64` VM, distinct from both the developer's real macOS machine and from Vercel's own build infrastructure) failed with `Error: Failed to fetch the engine file ... linux-arm64-openssl-3.0.x/schema-engine.gz - 403 Forbidden`, because that engine binary is not cached locally and the sandbox's network egress blocks `binaries.prisma.sh`. This independently reproduces and confirms Module 104's finding: it is a **sandbox/tooling-environment artifact**, not a production concern — Vercel's own build step always runs `npm install` (→ `postinstall` → `prisma generate`) on Vercel's own build machine, which generates the correct native engine for Vercel's runtime every deploy; no committed or cross-platform engine binary is ever shipped (confirmed: `.gitignore` excludes `/prisma/generated` and `/prisma/.generated-client`, and no engine binaries are tracked in git). See §11 for how this affected Phase 11 verification, and §11/§16 for what evidence this audit could and could not independently reproduce as a result.
- **Module 106 (Cloudinary document delivery):** Out of scope for this module (no Cloudinary architecture change made or needed); not rechecked in depth beyond confirming the GDPR Cloudinary purge cron route's DB/idempotency shape (§9).

---

## 5. Current Database Configuration

All values below are redacted per the module's File Safety rule (usernames/passwords never reproduced).

| Environment file | Host (redacted) | Port | Classification |
|---|---|---|---|
| `.env` | `aws-0-eu-west-1.pooler.supabase.com` | `5432` | Supabase Supavisor pooler, **session mode** |
| `.env.local` | `aws-0-eu-west-1.pooler.supabase.com` | `5432` | Supabase Supavisor pooler, **session mode** |
| `.env.production` | `aws-0-eu-west-1.pooler.supabase.com` | `5432` | Supabase Supavisor pooler, **session mode** |
| `.env.test` | `localhost` | `5432` | Local/disposable Postgres (CI-style), not Supabase |

- No `DIRECT_URL` variable is defined in any environment file, in `.env.example`, in `prisma/schema.prisma` (no `directUrl` datasource field), or in `src/core/infrastructure/config/env.ts`'s Zod schema. A single `DATABASE_URL` serves the application, `prisma migrate deploy`, `prisma db seed`, and the standalone admin scripts (`prisma/seed.ts`, `prisma/backfill-provider-role.ts`).
- No connection-string query parameters are present on any Supabase `DATABASE_URL` (no `pgbouncer=true`, no `connection_limit=N`, no `sslmode=`). Prisma therefore falls back to its own default pool sizing (`num_physical_cpus * 2 + 1` connections per `PrismaClient` instance) for every serverless invocation that constructs one.
- `TEST_DATABASE_URL` (Module 91's real-DB integration tier) is read only by `tests/test-utils/db/test-database-url.ts`, never by the running application, and that harness explicitly refuses any hostname resembling a managed/hosted provider (Supabase included) — a real safety guard against accidentally pointing integration tests at production data. Confirmed present and unmodified.
- Classification note on port 5432 vs 6543: Supabase's Supavisor pooler exposes **session mode on port 5432** and **transaction mode on port 6543** on the same `*.pooler.supabase.com` hostname. This project uses port 5432 exclusively — i.e., session mode, not transaction mode — everywhere a Supabase URL is used.

---

## 6. Prisma Client Lifecycle

**Files inspected (exhaustive `new PrismaClient` grep across the whole repository, excluding `node_modules`/`.next`):**

1. `src/core/infrastructure/database/prisma/client.ts` — the **one** production application client.
2. `src/core/infrastructure/database/prisma/replica-clients.ts` — one memoized client **per configured read replica** (Module 55, opt-in, off by default).
3. `prisma/seed.ts` — standalone one-shot seeding script, not part of the running application.
4. `prisma/backfill-provider-role.ts` — standalone one-shot backfill script, not part of the running application.

**Answers to the module's Phase 2 questions:**

1. *How many `PrismaClient` instances can exist in one server process?* Exactly one for the primary datasource (`client.ts`'s `globalThis`-cached singleton), plus at most one additional instance per distinct configured read replica (only reachable when `READ_REPLICAS_ENABLED=true` and `DATABASE_REPLICA_URLS` is populated — off by default, and even then each replica client is itself memoized in a `Map`, never recreated per call).
2. *Is a singleton used where appropriate?* Yes. `client.ts` uses the standard, Prisma-documented `globalThis` caching pattern for Next.js, with an explicit doc comment explaining why (hot-reload connection leak prevention).
3. *Is the implementation safe for Next.js/Vercel?* Yes — this is precisely the pattern Prisma's own Next.js guidance recommends. The client is instrumented via `$extends` (`withPrismaTracing`, `withReadReplicaRouting`) rather than wrapped or re-constructed, so instrumentation adds zero additional client instances.
4. *Can hot reload create unnecessary connections in development?* No — `globalForPrisma.prisma` is assigned outside production (`if (process.env.NODE_ENV !== "production")`), which is exactly the guard that prevents a new client (and new connection pool) on every dev-mode module reload.
5. *Can serverless invocations create excessive connections?* Each cold-started serverless function instance constructs one client (module-level `export const prisma`, evaluated once per instance, then reused for every invocation the instance handles — this is standard, correct Vercel/Next.js behavior, not a per-request client). The **number of concurrent instances** Vercel spins up under load — not anything in this code — is what determines total connection count; that ceiling is a Vercel project/plan setting, not visible from the repository (see §17, External Verification Required).
6. *Are there separate clients for jobs/tests?* Yes, appropriately: `prisma/seed.ts` and `prisma/backfill-provider-role.ts` are one-shot CLI scripts (each opens one client, runs once, and — being short-lived Node processes — exits, releasing its connection). Test suites use their own test-database wiring (`tests/test-utils/db/`), isolated from the production client module.
7. *Are any clients created per request?* No. No route handler, Server Action, or use-case composition root was found constructing `new PrismaClient()` — every one of the 40+ `Prisma*Repository` classes imports the shared singleton from `client.ts`.

**Conclusion: Prisma Client lifecycle is production-safe as implemented.**

---

## 7. Supabase Connection Pooling

The application connects exclusively through Supabase's Supavisor pooler in **session mode** (port 5432 on `*.pooler.supabase.com`), for application queries, migrations, and admin scripts alike.

Session mode's practical implications for this stack:

- **Prepared statements / interactive transactions:** fully supported. Session mode gives each Prisma connection its own dedicated session-scoped Postgres backend for the lifetime of that connection, so Prisma's prepared-statement caching and multi-statement `$transaction(async (tx) => …)` interactive transactions behave exactly as they would against a direct connection — no `pgbouncer=true` workaround or feature restriction is needed. This is a materially safer default than transaction-mode pgbouncer, which requires disabling prepared statements and imposes restrictions on session-level features.
- **Migrations:** session mode is Supabase's own documented recommendation for `prisma migrate deploy` (transaction-mode pooling is explicitly *not* recommended for schema migrations, due to advisory-lock and multi-statement DDL behavior). Using the same session-mode URL for migrations is therefore correct, not merely convenient.
- **Long-running/administrative operations:** also fine under session mode, for the same reason — no statement-level multiplexing to interact badly with.
- **What session mode does *not* give you:** connection multiplexing. Every open Prisma connection consumes one pooler slot 1:1, for as long as that Prisma Client instance is alive — unlike transaction mode, where many app-side connections can share a smaller number of backend Postgres connections. Under many *concurrent* Vercel serverless invocations (each a distinct, alive `PrismaClient` in its own instance), the effective ceiling is the session pooler's configured pool size for this Supabase project — a value set in the Supabase dashboard (Database → Connection Pooling → Pool Size), not in this repository.

**REQUIRES EXTERNAL SUPABASE/VERCEL VERIFICATION:** this audit cannot determine, from repository data alone, (a) the Supabase project's configured session-pooler pool size, (b) the Supabase plan tier's maximum client connections, or (c) Vercel's configured concurrency/regional-instance ceiling for this project. Per the module brief's explicit instruction, this is stated rather than guessed.

---

## 8. Connection Exhaustion Analysis

Patterns searched for and their results:

- **Long-running transactions containing network calls:** none found. Every `prisma.$transaction(async (tx) => …)` callback body in the financial repositories (`prisma-invoice-repository.ts`, `prisma-partner-payout-repository.ts`, `prisma-affiliate-commission-repository.ts`, `prisma-self-billing-authorization-repository.ts`, `prisma-credit-note-repository.ts`) was extracted and scanned programmatically for `fetch(`, `stripe.`, `cloudinary`, `axios`, and `await <x>Api` patterns — zero matches across all 7 transaction blocks in those five files (bodies ranging 21–100 lines). Every one of the 19 files repository-wide that use `$transaction` is a Prisma repository implementation file (or the tracing/read-replica extension machinery itself, or a multi-instance-safety test checker) — no application/use-case layer code holds a transaction open across an `await` on an external service.
- **Repeated client creation:** none — see §6.
- **Unbounded queries / missing pagination:** not exhaustively re-audited in this module (out of scope — this is a connection-lifecycle and pooling audit, not a query-performance audit); no evidence of this surfaced incidentally while reviewing the financial repositories above.
- **Cron/webhook connection spikes:** bounded by design — see §9/§10. Each cron invocation is a single HTTP request using the one shared singleton client; Vercel Cron does not fan out concurrent duplicate invocations of the same schedule, and the `DistributedLock`-guarded use-case layer additionally makes an overlapping trigger (a scheduler retry, or the in-process `JobScheduler` firing at the same time as platform cron in the Docker deployment path) a safe no-op (`outcome: "skipped_locked"`) rather than a second concurrent connection-holder.

**Conclusion:** no repository-level connection-exhaustion defect was found. The residual exhaustion risk is external and capacity-based (§7/§17): enough *simultaneous* Vercel function instances, each holding one session-mode pooler connection, could in principle approach the Supabase project's configured pool size — a scaling/capacity question, not a code defect.

---

## 9. Transaction Analysis

Inspected paths: commission ledger (`prisma-affiliate-commission-repository.ts`), reconciliation (use-case layer, not itself transactional at the repository level beyond individual writes), invoice/self-billing (`prisma-invoice-repository.ts`, `prisma-self-billing-authorization-repository.ts`, `prisma-credit-note-repository.ts`), payouts (`prisma-partner-payout-repository.ts`), Stripe-related persistence (webhook routes), and webhook idempotency.

- **Scoping:** every inspected `$transaction` block is scoped to a bounded sequence of Prisma reads/writes only (row lookups, status transitions, ledger inserts) — no unbounded loops, no pagination-dependent iteration, no external I/O.
- **External calls inside transactions:** confirmed absent (§8) for every financial repository transaction.
- **Serverless timeout safety:** because no transaction awaits network I/O, each transaction's duration is bounded by Postgres round-trip time for a small, fixed set of statements — well within any Vercel function timeout tier, with no dependency on a third party's latency.
- **Retry behavior:** the affiliate-commission repository's own doc comment (`prisma-affiliate-commission-repository.ts:276–327`) explicitly documents that its try/catch must wrap the `$transaction` call from the *outside* (never inside the callback) so Prisma can roll back cleanly on failure — evidence of deliberate, documented transaction-safety design rather than incidental correctness.
- **Idempotency:** `P2002` (unique-constraint violation) is caught and handled as an expected idempotency signal in at least 10 repository files (payment, support-ticket, affiliate-commission-reversal, dispute-resolution-decision, dispute, reconciliation-schedule-cursor, job, job-completion-confirmation, review, partner-payout) — consistent with a codebase that treats duplicate-write races as a normal, handled case rather than an unexpected error.
- **Connection persistence dependency:** none of the inspected transactions depend on a connection surviving across an external round-trip, so none are vulnerable to a serverless function being recycled or a pooler connection being reclaimed mid-transaction due to an external API being slow.

**Conclusion:** transaction safety on every inspected financial path is sound for serverless execution.

---

## 10. Migration Strategy

- `prisma/migrations/` contains 64 committed migration directories plus `migration_lock.toml` — all committed to git (confirmed via `git status` showing no untracked/modified migration files).
- Sanctioned production migration command: `npm run prisma:migrate:deploy` → `prisma migrate deploy` — documented in `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md` §11 as "the only sanctioned production migration path — never `prisma db push`."
- **Application startup does not run migrations.** The `Dockerfile`'s own comment is explicit that this is deliberate: "Prisma migrations are deliberately NOT run automatically by this image (no `prisma migrate deploy` in the entrypoint) ... multiple replicas starting concurrently must never race to apply the same migration." No `postinstall`/`prestart` hook runs `migrate deploy` either — `postinstall` runs only `prisma generate` (client generation, not schema migration; safe to run redundantly on every instance).
- **Migrations are not run concurrently by every serverless instance** — because they are not run by any serverless instance at all. The documented model (§11 of the same doc, restated in its "Pre-launch checklist") is a dedicated, single-runner, explicit deploy step ("Run `prisma migrate deploy` as an explicit, single-runner step before rolling out new app instances") — correct for both the Docker and Vercel deployment shapes, since neither the container entrypoint nor a Vercel build step in this repository invokes it automatically.
- **CI verification:** `.github/workflows/ci.yml` runs `prisma migrate deploy` then `prisma migrate status` against its own ephemeral CI Postgres service on every push/PR to `main`, confirming every merged migration set is deployable and leaves the schema in a clean state — but this validates the *migration files*, not a deploy against the production Supabase database (no workflow targets production).
- **Evidence already established (per module brief) from local verification against the configured Supabase database:** `npx prisma migrate status` reported **64 migrations found** and **"Database schema is up to date."** This audit's own attempt to reproduce that check independently, from this session's own tooling, is addressed in §11.

**Conclusion:** the migration strategy — committed migrations, explicit single-runner `migrate deploy`, no entrypoint auto-migration, CI validation of the migration set — is production-appropriate for both Docker and Vercel deployment targets.

---

## 11. Vercel Runtime Analysis

- **Node.js version:** `.nvmrc` pins `20`; `package.json`'s `engines.node` requires `>=20.0.0`. Consistent.
- **Runtime:** no route in the repository declares `export const runtime = "edge"` — every route (cron, webhooks, health checks, application API routes) runs on Vercel's default Node.js serverless runtime, which is what Prisma's native query engine requires (Prisma's Node-API engine is not Edge-runtime-compatible without the separate Accelerate/Data Proxy product, which this repository does not use — correctly, since introducing a database proxy is explicitly out of scope for this module).
- **`maxDuration`:** not set anywhere (`vercel.json` or route-level `export const maxDuration`) — every route, including the four cron routes, runs under the Vercel plan's default function-duration ceiling. **External verification required:** whether the reconciliation sweep or GDPR purge retry (the two batch-oriented cron jobs) can complete within the account's default duration under production data volume cannot be determined from the repository; both use cases are explicitly bounded by a configurable batch size (`RECONCILIATION_SCHEDULE_LIMIT`, `GDPR_CLOUDINARY_PURGE_RETRY_BATCH_SIZE`), which mitigates but does not eliminate this risk at large scale.
- **Build/install commands:** standard (`npm ci` in CI; Vercel's own default `npm install`/`next build` apply since no custom `buildCommand`/`installCommand` override exists in `vercel.json`). `postinstall: "prisma generate"` guarantees the Prisma Client (and its native query engine) is regenerated for whatever platform runs the install — i.e., Vercel's own Amazon-Linux-based build image when deployed there, correctly matching Vercel's runtime automatically on every build.
- **Region configuration:** none specified in `vercel.json` — deploys to Vercel's project-level default region setting (an account/dashboard setting, not a repository one).
- **Prisma binary target / Module 104 mismatch — is it a sandbox artifact or a production risk?** Confirmed **sandbox artifact only, not a production risk.** This audit independently reproduced the underlying cause: the locally-generated engine on the developer's machine is `libquery_engine-darwin-arm64.dylib.node` (confirmed present in `node_modules/.prisma/client/`), while this session's own device shell is a `linux-arm64` (`aarch64`) sandbox whose network egress blocks `binaries.prisma.sh` (confirmed: `npx prisma migrate status` from that shell failed with `403 Forbidden` fetching the `linux-arm64-openssl-3.0.x` schema-engine, both with and without `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`). This is purely a property of *local development/audit tooling machines* having a different OS/arch than the sandbox this session runs in. It does not affect Vercel: Vercel's build step always runs `prisma generate` fresh on Vercel's own build machine (via `postinstall`), producing the correct engine for Vercel's actual runtime architecture every single deploy — no cross-platform or pre-generated engine binary is ever committed or shipped (`.gitignore` excludes `/prisma/generated` and `/prisma/.generated-client`). **No `binaryTargets` override is needed or was made** — changing `binaryTargets` would only be justified by a demonstrated production requirement (e.g., deploying to a platform whose build step doesn't run `prisma generate` natively), which does not apply to Vercel.

---

## 12. Cron Infrastructure

Four cron routes, all following one consistent, well-documented pattern:

| Route | Schedule | Auth | Concurrency/idempotency protection |
|---|---|---|---|
| `/api/cron/expire-workflows` | daily 03:00 UTC | `Authorization: Bearer $CRON_SECRET`, timing-safe compare, fail-closed (503) if `CRON_SECRET` unset | Use case operates on already-expired-by-timestamp rows; safe to re-run |
| `/api/cron/reconciliation-run` | every 6h | same | `DistributedLock` (Module 44) around the full cursor read/select/reconcile/advance cycle; a losing overlapping call returns `outcome: "skipped_locked"` (200, non-blocking); discrepancies additionally deduplicated via `createOrTouch` fingerprint + DB partial unique index |
| `/api/cron/gdpr-cloudinary-purge` | every 30 min | same | Use-case-internal claim/succeeded/retried/dead-lettered accounting; documented "route stays thin, use case owns concurrency/locking" contract |
| `/api/cron/referral-affiliate-maintenance` | daily 04:00 UTC | same | Existing `DistributedLock` (Module 44), per the route's own doc comment; deliberately never triggers payouts (admin-triggered only) |

- **`CRON_SECRET`:** validated via `isValidCronAuthHeader()` (`src/core/infrastructure/auth/cron-auth.ts`), which uses `node:crypto`'s `timingSafeEqual` with a `Buffer.byteLength`-based length pre-check — a documented Module 95 hardening (previously a timing-unsafe `!==` comparison). All four routes fail closed (`503`) when `CRON_SECRET` is unconfigured, rather than silently skipping auth.
- **Vercel schedule configuration:** matches `vercel.json`'s four `crons` entries exactly; no orphaned or undeclared cron routes found.
- **Duplicate-execution protection:** three of the four routes (reconciliation, GDPR purge, referral/affiliate maintenance) are explicitly documented as using the existing `DistributedLock` primitive; `expire-workflows` is idempotent by construction (its query selects only currently-eligible rows, so a duplicate run finds nothing new to expire).
- **Database usage per invocation:** one request through the shared singleton Prisma Client per route per firing; no route constructs its own client.

**Conclusion:** cron infrastructure is production-appropriate; no concurrency or connection-spike risk identified.

---

## 13. Webhook Infrastructure

Three webhook routes: `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/stripe-payments/route.ts`, `src/app/api/webhooks/persona/route.ts`.

- All three follow the same documented three-stage contract referenced in their own doc comments: **signature verification → idempotency handling → application use case**, with the idempotency stage explicitly designed to satisfy `infrastructure/multi-instance-safety/checkers/idempotency-checker.ts`'s own expectations (i.e., idempotency is itself an audited invariant elsewhere in this codebase, not an incidental property).
- **Normal Prisma connections:** each webhook delivery is one HTTP request through the shared singleton client — no per-request client construction (consistent with §6's exhaustive search).
- **Retries causing connection spikes:** Stripe/Persona retries re-invoke the same route, which re-enters the same signature-verify → idempotency-check flow; a retried event that was already processed is expected to short-circuit at the idempotency check before reaching any transaction, per the documented contract. This audit did not find a code path where a duplicate webhook delivery would re-execute a financial `$transaction`.
- **Transactions scoped appropriately:** webhook-triggered financial writes flow through the same repository `$transaction` blocks already verified network-call-free in §8/§9.
- **Safety under concurrent Vercel invocations:** each webhook route is stateless HTTP-request-scoped, backed by the same connection-safe singleton client and idempotency-guarded persistence — no additional per-webhook concurrency risk beyond the general pooling capacity question already covered in §7/§17.

**Conclusion:** webhook infrastructure is production-appropriate from an infrastructure/connection perspective. (Stripe/Persona business logic itself was not reviewed or modified, per scope.)

---

## 14. Concurrency Analysis

- **Connection exhaustion:** see §7/§8 — no repository-level defect; residual risk is external pooler capacity vs. Vercel concurrency ceiling (External Verification Required).
- **Duplicate cron execution:** protected via `DistributedLock` on the three batch-oriented jobs and idempotent-by-construction querying on the fourth (§12).
- **Duplicate webhook processing:** protected via the documented idempotency-check stage common to all three webhook routes (§13).
- **Concurrent payout processing:** `prisma-partner-payout-repository.ts`'s `$transaction` scopes the payout state transition; payouts are additionally admin-triggered only (never cron-triggered), reducing the concurrent-invocation surface to begin with.
- **Concurrent reconciliation:** explicitly `DistributedLock`-guarded, with a documented fallback behavior (`skipped_locked`) rather than blocking or double-processing.
- **Concurrent invoice processing:** `prisma-invoice-repository.ts` transactions are scoped per-invoice-operation; no cross-invoice batch loop with an open transaction was found.

**NOT LOAD TESTED.** No actual concurrent-load test was run against the production or a disposable Supabase instance in this module (running one against the linked production database would violate the module's explicit read-only/no-mutation constraint, and no disposable Supabase instance was provisioned). Per the module brief's explicit instruction, this is stated plainly rather than estimated.

---

## 15. Observability

- **Sentry integration:** `@sentry/nextjs` is a declared dependency; `instrumentation.ts` is present at the repository root (Next.js's standard Sentry/OpenTelemetry registration hook). Cron and webhook routes call `createErrorReporter().reportException(...)` / `.reportMessage(...)` on failure paths (confirmed in all four cron routes, §12) — every unexpected cron failure and every reconciliation `run_failed` outcome is explicitly reported, not just logged.
- **Database error logging:** `logger.error(...)` calls precede every reported exception in the cron routes, each carrying a `requestId` and route name for correlation.
- **Prisma error handling:** `Prisma.PrismaClientKnownRequestError` with code `P2002` (unique violation) is explicitly caught and handled as an idempotency signal in 10+ repository files (§9) — the codebase distinguishes "expected duplicate" from "unexpected database error" rather than treating all Prisma errors uniformly.
- **Connection/timeout handling visibility:** `/api/health/ready` (`src/app/api/health/ready/route.ts`) explicitly checks Postgres reachability through the shared `prisma` client and is the one check whose failure changes the route's overall status/HTTP code — its own doc comment states the reasoning precisely: "checks the one dependency this application cannot function without: PostgreSQL... a database that's unreachable means every meaningful request would fail anyway." Redis, cache, search, realtime, and other dependencies are deliberately visibility-only and do not fail readiness — a correct production distinction between hard and soft dependencies.
- **Migration failure visibility:** CI's `prisma migrate deploy` + `prisma migrate status` steps fail the pipeline (and therefore block merge) on any migration problem; there is no equivalent automated signal for a production `migrate deploy` run, because that step is manual by design (§10) — an operator running it would see its own exit code/output directly.

**Conclusion:** a production operator can identify database-unavailable (via `/api/health/ready` and Sentry), Prisma initialization/connection failures (via the same readiness check plus cron/webhook exception reporting), and cron/webhook DB failures (explicit Sentry `reportException`/`reportMessage` calls) from existing instrumentation. Migration-failure visibility depends on whoever runs the manual `migrate deploy` step observing its own output — adequate given the deliberately manual, single-runner design, but worth naming as an operational (not code) responsibility.

---

## 16. Real Database Verification

**Attempted:** `npx prisma migrate status` (the only command this module's Phase 11 authorizes), run from this session's linked-device shell against the repository's configured `.env` (Supabase) `DATABASE_URL`.

**Result: environment-blocked, not executed by this audit.** The command failed before reaching the database at all:

```
Error: Failed to fetch the engine file at
https://binaries.prisma.sh/all_commits/<hash>/linux-arm64-openssl-3.0.x/schema-engine.gz - 403 Forbidden
```

This session's local-device shell is a sandboxed Linux `aarch64` VM whose network egress does not permit reaching `binaries.prisma.sh` to download the `linux-arm64` schema-engine binary (the only locally-generated engine present, `libquery_engine-darwin-arm64.dylib.node`, is for macOS/arm64, confirming this is the same class of environment mismatch Module 104 already identified — see §11). Retrying with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` (a documented, non-destructive Prisma offline-environment flag) produced the same `403 Forbidden`, confirming the failure is network egress, not a checksum-verification-only issue. `psql` is not installed in this shell, so no alternative direct read-only query was possible either.

**No database mutation of any kind was attempted or occurred.** No `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`DROP`/`TRUNCATE`/`migrate`/`reset`/`db push` was run, per the module's explicit prohibition.

This audit therefore relies on the evidence already supplied in the module brief — obtained by a prior, successful local run of `npx prisma migrate status` against the same configured Supabase database, reporting **64 migrations found** and **"Database schema is up to date"** — as the current record of production schema state. That evidence is consistent with, and corroborated by, this repository's own migration directory count (64 migration folders, §3/§10). This audit did not independently re-derive it due to the sandbox network constraint documented above, and states that limitation explicitly rather than presenting the number as freshly re-verified.

---

## 17. Findings

| # | Finding | Classification |
|---|---|---|
| F1 | Single `DATABASE_URL` (Supabase session-mode pooler, port 5432) used for application runtime, migrations, and admin scripts, with no `DIRECT_URL` split and no `connection_limit`/`pgbouncer` query parameters. Architecturally safe (session mode supports prepared statements/interactive transactions natively) but its effective capacity under concurrent Vercel serverless load depends on the Supabase project's pool-size/plan tier, which cannot be confirmed from the repository. | **Medium — External Verification Required** |
| F2 | No `maxDuration` configured for the two batch-oriented cron routes (reconciliation, GDPR purge); both are batch-size-bounded, which mitigates but does not eliminate a large-scale duration risk. | **Low — External Verification Required** |
| F3 | Prisma engine binary platform mismatch reproduced in this audit's own sandbox tooling (darwin-arm64 generated locally vs. linux-arm64 sandbox runtime); confirmed to have no bearing on Vercel, whose build always regenerates the engine natively. | **Informational** |
| F4 | Production Supabase pool size, Supabase plan tier, and Vercel project concurrency/region settings are not visible from the repository. | **External Verification Required** |
| F5 | No repository-level connection-exhaustion, transaction-safety, cron-concurrency, or webhook-idempotency defect was found in any inspected path. | **Informational (positive finding)** |

No Critical or High findings were identified.

---

## 18. Required External Configuration

The following are **external dashboard/configuration verification items**, not code defects, and per the module brief's instruction are not treated as reasons to lower the readiness score:

1. **Confirm the Supabase project's session-pooler pool size** (Database → Connection Pooling in the Supabase dashboard) is sized for the maximum number of concurrent Vercel function instances this deployment can reach, and confirm the Supabase plan tier's overall connection ceiling. If the team later observes connection-pool-exhaustion errors under real production load, the standard, well-documented remedy — adding `?connection_limit=1` (or a similarly small, explicit value) to the pooled `DATABASE_URL`, and/or optionally adding a separate `DIRECT_URL` (a direct, non-pooled connection) for `prisma migrate deploy` only — is a `.env`/Vercel-environment-variable change. This module's File Safety rule explicitly forbids modifying `.env`/`.env.local`/`.env.production`/`.env.test`, so this change, if the team decides it is warranted after checking the dashboard numbers above, must be made by the team directly in Vercel's Environment Variables settings (and/or the relevant `.env*` file), not by this audit.
2. **Confirm Vercel's configured concurrency/scaling ceiling and region(s)** for this project align with the Supabase pooler capacity confirmed in (1).
3. **Confirm the production migration runbook** (§10's documented "run `prisma migrate deploy` as an explicit, single-runner step before rollout") is actually followed as an operational step in the team's real deployment process — no CI/CD workflow in this repository automates it, by design, so this is a process confirmation, not a code check.
4. **Confirm whether the two batch-oriented cron jobs' default Vercel function duration is sufficient** at production data volume, or whether an explicit `maxDuration` should be set — this depends on the account's plan tier and real batch sizes, neither visible from the repository.

---

## 19. Implementation Changes, if any

**None.** Per §17's F1, the one substantive architectural question this audit surfaced (connection-string pooling mode/split) resolves to a `.env`/Vercel-environment-variable decision that this module's own File Safety rule places out of reach ("Do not modify: `.env`, `.env.local`, `.env.production`, `.env.test`"), and whose correct value depends on external Supabase/Vercel dashboard data this audit cannot see or guess (per the module's explicit "Do not guess" instruction). No other repository-level defect was found that would justify a code change under this module's "smallest safe fix, only if a concrete problem is proven" standard. This is an **Option A — audit-only** module.

`git status` was re-checked after the audit (§21) and shows only this report as a new file, plus the pre-existing untracked `legal/` directory.

---

## 20. Tests and Verification

| Check | Result |
|---|---|
| `npm run typecheck` | **Not applicable** — no source code was changed |
| `npm run lint` | **Not applicable** — no source code was changed |
| Prisma/database tests | **Not applicable** — no source code was changed; existing CI already exercises `prisma migrate deploy`/`migrate status`/unit/integration/real-DB-integration suites on every push (§3) |
| `npx prisma migrate status` (Phase 11, read-only) | **Environment blocked** — sandbox network egress prevented downloading the required engine binary (§16); relied on the module brief's already-supplied result (64 migrations found, schema up to date) |
| Static/manual audit of Prisma Client instantiation, transaction bodies, cron/webhook routes | **Passed** — see §6, §8, §9, §12, §13 |

---

## 21. Remaining Risks

- **Pooler capacity under real concurrent load is unverified** (F1/F4) — the single highest-value follow-up action, and one only the team can close via the Supabase/Vercel dashboards.
- **No load test has been run** against this database/pooling configuration (§14) — "not load tested" is an honest gap, not a passing grade.
- **Batch-cron duration at production scale is unverified** (F2) — mitigated by existing batch-size limits but not proven safe at arbitrary scale.
- **Migration deployment discipline is a manual process**, correctly documented but not automation-enforced — a human error (forgetting to run `migrate deploy` before a schema-dependent deploy, or running it against the wrong environment) remains possible in principle, as with any manual-step runbook.

---

## 22. Production Readiness Score

| Area | Weight | Score | Rationale |
|---|---|---|---|
| Prisma lifecycle | 15 | 15 | Correct singleton, hot-reload-safe, no per-request clients (§6) |
| Database/pooling architecture | 20 | 14 | Architecturally safe session-mode choice, but capacity/split unverified externally (§7, F1) |
| Serverless concurrency | 15 | 13 | No code-level exhaustion pattern found; external pooler-capacity dependency (§8) |
| Transaction safety | 10 | 10 | No external calls inside any inspected financial transaction (§9) |
| Migration strategy | 10 | 10 | Committed migrations, explicit single-runner deploy, no entrypoint auto-migration, CI-validated (§10) |
| Vercel runtime/deployment | 15 | 13 | Correct runtime/Node version/build pipeline; `maxDuration` unset for batch crons (§11, F2) |
| Cron/webhook infrastructure | 5 | 5 | Consistent auth, locking, idempotency across all routes (§12, §13) |
| Observability | 5 | 5 | Readiness check, Sentry reporting, Prisma-error handling all present and correctly scoped (§15) |
| Operational clarity | 5 | 5 | Migration/deployment runbook explicitly documented; findings clearly separated code vs. external (§10, §18) |

**Production Database & Vercel Infrastructure Readiness: 90/100**

(No points deducted for the external dashboard/configuration items themselves, per the module brief's explicit instruction; points reflect only what remains genuinely unverified or unset in scope this audit controls.)

---

## 23. Final Verdict

**READY WITH MEDIUM CONFIGURATION FINDINGS**

The Module 105 database-pooling finding is: **PARTIALLY RESOLVED.** The repository-level risk it could have represented (unbounded client creation, unsafe transaction/connection patterns) is confirmed absent. The external portion — actual Supabase pooler capacity vs. Vercel concurrency ceiling — remains **EXTERNAL VERIFICATION REQUIRED**, and per this module's own File Safety constraints, any resulting connection-string change is an operational/environment-variable action for the team, not a code change this audit can make.

---

## 24. Recommended Next Module

**Module 108 — Load Testing & Capacity Validation Against Production-Equivalent Supabase/Vercel Configuration.** With the code-level pooling and transaction-safety questions closed by this module, the highest-value next step is empirical: provision a disposable Supabase project (or a documented staging tier of the real one) with the same pooler mode, run the existing `npm run load-test`/`npm run capacity-report` tooling (already present in this repository, per `package.json`) against it under realistic concurrent Vercel-shaped load, and use the result to make an evidence-based decision on §18's connection-string questions — closing F1/F4 with data rather than external verification language.

---

## Final Summary

- **Score:** 90/100
- **Critical:** 0 | **High:** 0 | **Medium:** 1 (F1) | **Low:** 1 (F2) | **Informational:** 2 (F3, F5)
- **External verification items:** 4 (§18)
- **Prisma Client assessment:** Production-safe singleton; no per-request or excessive instantiation found.
- **Supabase pooling assessment:** Session-mode pooler in use, architecturally safe for Prisma but capacity vs. Vercel concurrency unverified externally.
- **Vercel assessment:** Correct runtime, Node version, and build pipeline; `maxDuration` unset for two batch cron jobs (low-severity, mitigated by batch-size bounds).
- **Migration assessment:** Sound — committed migrations, explicit single-runner `migrate deploy`, no entrypoint auto-migration, CI-validated.
- **Cron assessment:** Sound — consistent timing-safe auth, `DistributedLock`-backed concurrency protection.
- **Webhook assessment:** Sound — consistent signature-verify → idempotency-check → use-case pattern across all three routes.
- **Code changes required:** No.
- **Production DB schema currently confirmed:** Per the module brief's prior local verification (64 migrations, up to date); this audit's own re-verification attempt was environment-blocked (§16) and is reported as such, not silently assumed.
- **Final verdict:** READY WITH MEDIUM CONFIGURATION FINDINGS
- **Recommended Module 108:** Load Testing & Capacity Validation Against Production-Equivalent Supabase/Vercel Configuration
