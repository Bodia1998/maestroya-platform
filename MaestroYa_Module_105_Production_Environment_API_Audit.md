# MaestroYa — Module 105: Production Environment & External API Readiness Audit

**Audit date:** 2026-09-13
**Mode:** Strict read-only audit. No TypeScript/TSX source, tests, Prisma schema, migrations, `package.json`/lockfiles, env files, deployment/CI/Docker config, other documentation, or database data/schema was modified. No `npm install`, `prisma generate/migrate`, Docker start/stop, database creation, env-var mutation, or external API call was performed. No git write command was run (`git status`, `git log`, `git branch --show-current`, and read-only `grep`/`cat` of files only). The only repository change made by this pass is the creation of this single report file. No real secret value is printed anywhere in this document — only presence/absence and shape metadata.

---

## 1. Executive Summary

MaestroYa's environment and external-integration layer is unusually mature for a pre-launch marketplace: a single, heavily-documented, Zod-validated configuration module (`src/core/infrastructure/config/env.ts`, 1,105 lines) is the sole boundary between `process.env` and the rest of the codebase, and it enforces a consistent, auditable discipline — every swappable external provider (SMS/Twilio, identity verification/Persona, fraud signals/FingerprintJS+IPQS, geocoding, search) defaults to a safe, network-free local implementation and only requires its real credentials once explicitly selected, with hard `superRefine` checks that fail application startup in `NODE_ENV=production` if a selected provider's credentials are missing. Stripe, Cloudinary, Resend, and the two Auth secrets are unconditionally required in every environment (including local dev) rather than optionally wired, which is a deliberate, documented trade-off inherited from earlier modules.

Four Vercel Cron routes each independently verify a timing-safe `CRON_SECRET` bearer token and fail closed (HTTP 503, request rejected) if the secret is not configured — there is no "cron auth disabled" code path. Stripe and Persona webhook signature verification are both implemented correctly (raw-body HMAC verification before any parsing, timing-safe comparison, replay-window checks for Persona). Redis-backed rate limiting has a documented, enforced, double fail-closed guarantee: `env.ts`'s `superRefine` requires `REDIS_URL` in production, and `rate-limit-repository-factory.ts` independently throws rather than silently falling back to the in-memory implementation if `REDIS_URL` is somehow still absent in production — a genuine belt-and-suspenders pattern, not marketing language.

No committed secrets (live or otherwise) were found anywhere in the tracked source tree or in a sampled `git log` search for the `sk_live_` pattern across all commits (0 matches). All `sk_test_`/`pk_test_`/`whsec_` occurrences found are confined to test fixtures, `.github/workflows/ci.yml` placeholders, the build-only `ENV` lines in `Dockerfile`, and `env.ts`'s own doc comments — never real credentials.

The principal gap this audit found is not a code defect but the expected, unavoidable state of a pre-launch repository: **no production credential is present for any paid external service** (Stripe live keys, Resend, Cloudinary, Persona, Redis, Sentry, Twilio, geocoding/search providers) — every `.env*` file on disk contains only local/placeholder values or is empty for those fields, and Vercel dashboard-side environment variable configuration cannot be verified from this repository at all. This is expected pre-launch state, not a defect, and is classified A/B per the framework below rather than driving a NOT READY verdict. A pre-existing MEDIUM finding from Module 103 (unsigned Cloudinary `private`-mode verification-document delivery URLs) is re-confirmed as still open. The unresolved materials/commission tax formula disagreement (Module 100/prior audits) and a pending, unengaged legal consultation (see `legal/` folder) remain open legal/business blockers this module does not attempt to resolve, only references.

**Score: 78 / 100. Verdict: READY WITH MEDIUM-LOW CONFIGURATION FINDINGS** (external credential/dashboard verification required before go-live; no blocking code defect found).

---

## 2. Audit Scope

In scope: environment variable inventory and validation; Stripe, Resend, Cloudinary, Persona, Redis, and cron subsystems; authentication/session security; Vercel, GitHub Actions CI, and Docker configuration; production/test credential separation; fail-closed behavior of every credentialed subsystem; a read-only secret-leak scan of the tracked working tree and a sampled `git log` search. Out of scope / not performed: any live network call to a real external provider, any database connection, any dependency installation, any Vercel/GitHub/Stripe/Resend/Cloudinary/Persona dashboard inspection (no credentials or access were available or used), and any code change of any kind. Findings that require dashboard-side confirmation are explicitly marked "REQUIRES [X] DASHBOARD VERIFICATION" rather than guessed at.

---

## 3. Repository Baseline

| Item | Value |
|---|---|
| Repository root | `$HOME/mnt/maestroya-platform-auth` (device-mounted; on the user's machine at `/Users/bodia1998/projects/maestroya-platform-auth`) |
| Branch | `feature/module-105-production-environment-api-audit` |
| HEAD | `311a7da` — "Merge pull request #115 from Bodia1998/feature/module-104-full-test-suite-verification" |
| `git status --short` before this audit | `?? legal/` (untracked folder of legal PDFs/PPTX/DOCX — filenames only reviewed, contents not opened) |
| Stack | Next.js 15.1, TypeScript, Prisma 6.19.3, PostgreSQL 16, Clean Architecture/DDD with manual dependency injection (`compose.ts` factory files throughout), Vercel deployment target, Stripe Connect, Resend, Cloudinary, Persona, Redis with documented in-memory fallback, Vercel Cron for background jobs |
| Node version pin | `.nvmrc` = `20`; `package.json` `engines.node` = `>=20.0.0`; `Dockerfile` `ARG NODE_VERSION=20-alpine` — consistent across all three |
| `git log --all --oneline \| wc -l` | 247 commits |
| Sampled secret-leak `git log -p -S "sk_live_"` across all commits | 0 matches |


## 4. Previous Findings Rechecked

No file named `MODULE_101_*` or `MODULE_102_*` (in either the legacy `MODULE_NN_*` or `MaestroYa_Module_NN_*` naming convention) exists in the repository root or anywhere under `docs/`. A targeted search for the strings "Module 101" and "Module 102" inside the existing module reports and roadmap documents returned no matches. This audit therefore cannot confirm the existence or content of standalone "Module 101" (production configuration) or "Module 102" (legal/tax blocker) reports — **UNKNOWN / NOT FOUND IN REPOSITORY**, not assumed to exist. What this audit *could* independently verify and cross-reference instead:

- **Materials/commission tax formula disagreement.** `MaestroYa_Production_Readiness_Audit_2026-08-29.md` (§ finding H5) documents that `CalculateJobCommissionBreakdownUseCase` and `CalculateJobTaxBreakdownUseCase` disagreed on whether `CUSTOMER_PURCHASED`-materials line items count toward the commission/tax base, and that the reconciliation engine already has a dedicated category for this drift (`INVOICE_COMMISSION_AMOUNT_INCONSISTENT`). `MaestroYa_Roadmap_to_90_2026-08-29.md` records this as a planned fix. Later modules (`MODULE_97_TAX_IVA_PRODUCTION_INTEGRATION_REPORT.md`, `MODULE_98_PROFESSIONAL_TAX_BUSINESS_VERIFICATION_AUDIT.md`/`_REPORT.md`) exist and appear to address IVA/tax production wiring, but this audit did not re-open and line-by-line re-verify H5's current resolution status — that is outside Module 105's environment/API scope. Flagged here only as unresolved-business-logic context for §23 (Launch Blockers), not re-litigated.
- **Legal/business blocker.** The untracked `legal/` folder (filenames only reviewed, per this audit's explicit scope limit) contains `MaestroYa_Legal_Consultation_RFP.pdf/.pptx`, three `MaestroYa_Cost_Brief_*` documents for named legal advisors, and `MaestroYa_Law_Firm_Cost_Comparison.pdf/.pptx` — consistent with an unresolved, not-yet-engaged legal consultation process rather than a completed one. This audit does not open or interpret the contents of any file in `legal/`, per its instructions; it is referenced here only as external, non-code context for §23.
- **Module 103 — IDOR Authorization Audit** (`MaestroYa_Module_103_IDOR_Authorization_Audit.md`) is directly relevant to this module's Cloudinary section and is re-checked in §9 below: its MEDIUM finding ("document delivery/signed-URL gap") is independently re-confirmed still present in the current codebase (the same two upload-service files and the same absence of any `private_download_url`/`utils.sign` call were re-verified this pass).
- **Module 104 — Full Test Suite Verification** (`MaestroYa_Module_104_Full_Test_Suite_Verification.md`) independently confirmed CI (`ci.yml`) is the only environment in which a real PostgreSQL-backed integration suite, `next build`, and E2E were exercised, and that this sandboxed-VM class of environment cannot reach a live Postgres instance or complete `next build` in a bounded time window — consistent with what this audit also found (see §16/§17): environment-variable and static-code verification is achievable here, live-service/dashboard verification is not.
- **Module 100 — Affiliate Accumulated Balance Report** confirms the general pattern this audit also observed: prior modules consistently and explicitly distinguish "not run because this sandbox lacks reachable Postgres/network" from "found broken," a distinction this report also preserves throughout.


## 5. Environment Variable Inventory

**Source of truth:** `src/core/infrastructure/config/env.ts` (Zod schema, 1,105 lines) is the single validated boundary — confirmed by repository-wide convention (no other file constructs a competing schema) and by its own doc comment ("Import `env` instead of reading `process.env` directly anywhere else in the codebase"). `.env.example` (14.5 KB, fully comment-annotated) mirrors it var-for-var and is the canonical local-setup reference. All files consulted: `.env.example`, `.env`/`.env.local`/`.env.production`/`.env.test`/`.env.test.local` (variable **names** only — values never read for secret-shaped fields, per this audit's rules), `vercel.json`, `.github/workflows/ci.yml`, `docker-compose.yml`/`docker-compose.prod.yml`, `Dockerfile`.

Every variable below is validated at the same single boundary; "Validated" = Yes for all of them (Zod schema). Columns: **Req** = required at schema level in *every* environment (fails startup immediately if absent) vs Optional (schema-level); **Prod-required** = additionally enforced only in `NODE_ENV=production` via the `superRefine` block (env.ts lines 821-1072); **Server/Client** = server-only unless marked `NEXT_PUBLIC_*`; **Fail-closed?** = what happens application-wide when absent.

### 5.1 Core / App / Database

| Variable | Req | Prod-required | Scope | Consumed | Fail-closed on absence |
|---|---|---|---|---|---|
| `NODE_ENV` | Optional (default `development`) | — | Server | env.ts | Defaults to development |
| `NEXT_PUBLIC_APP_URL` | Required | Must be `https://` in prod | Client | env.ts, many | Startup fails (invalid URL / not https in prod) |
| `LOG_LEVEL` | Optional (default `info`) | — | Server | logger | Falls back to info |
| `DATABASE_URL` | Required | — | Server | Prisma `schema.prisma` `env("DATABASE_URL")`, `prisma/client.ts` | Startup fails immediately (`min(1)`) — see §6 for pooling/SSL notes |
| `TEST_DATABASE_URL` | N/A — read only by `tests/test-utils/db/test-database-url.ts`, never by `env.ts`/the app | — | Test-only | `npm run test:integration:db` | Test-only, never production |

### 5.2 Auth.js / Session

| Variable | Req | Prod-required | Scope | Fail-closed |
|---|---|---|---|---|
| `AUTH_SECRET` | Required | Yes — must be ≥32 chars in prod | Server | Startup fails; length check is production-only |
| `AUTH_URL` | Required (URL) | Must be `https://` in prod | Server | Startup fails |
| `AUTH_TRUST_HOST` | Optional (default `"true"`) | — | Server | Defaults on; required explicit for non-Vercel hosts (Docker) |
| `AUTH_GOOGLE_ID`/`_SECRET` | Optional | Not prod-enforced | Server | Provider simply fails at sign-in if unset — not a startup gate |
| `AUTH_APPLE_ID`/`_SECRET` | Optional | Not prod-enforced | Server | Same as above |
| `AUTH_FACEBOOK_ID`/`_SECRET` | Optional | Not prod-enforced | Server | Same as above |

**Note (Finding — see §22):** OAuth provider credentials are optional at both the schema and production-superRefine level. If unset in production, `next-auth`'s `Google`/`Apple`/`Facebook` providers are still registered with empty `clientId`/`clientSecret` strings (auth-config.ts lines 124-135) — the app does not error at startup, but every OAuth sign-in attempt will fail at request time. This is a soft (not hard) fail-closed for OAuth specifically; email/password remains the guaranteed working path.

### 5.3 Stripe (see §7 for full audit)

| Variable | Req | Prod-required | Fail-closed |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Required | Yes — `sk_test_` prefix rejected in prod | Startup fails |
| `STRIPE_PUBLISHABLE_KEY` | Required | Yes — `pk_test_` prefix rejected in prod | Startup fails |
| `STRIPE_WEBHOOK_SECRET` | Required | — | Startup fails if unset (unconditional, every env) |
| `STRIPE_PAYMENTS_WEBHOOK_SECRET` | Required | — | Startup fails if unset (unconditional, every env) |
| `STRIPE_CONNECT_CLIENT_ID` | Optional | — | Connect OAuth onboarding link generation fails at call time if unset |
| `STRIPE_DISPUTE_SYSTEM_USER_ID` | Optional (UUID) | — | LOST-dispute financial settlement deferred to manual review (logged) rather than mis-attributed — see §7 |

### 5.4 Cloudinary (see §9)

| Variable | Req | Prod-required | Fail-closed |
|---|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | Required | — | Startup fails |
| `CLOUDINARY_API_KEY` | Required | — | Startup fails |
| `CLOUDINARY_API_SECRET` | Required | — | Startup fails |

### 5.5 Resend / Email (see §8)

| Variable | Req | Prod-required | Fail-closed |
|---|---|---|---|
| `RESEND_API_KEY` | Required | — | Startup fails |
| `EMAIL_FROM` | Required | — | Startup fails |

### 5.6 Persona / Identity Verification (see §10)

| Variable | Req | Prod-required | Fail-closed |
|---|---|---|---|
| `VERIFICATION_PROVIDER` | Optional, `.catch("manual")` | — | Invalid value silently degrades to safe `manual` workflow |
| `PERSONA_API_KEY` | Optional | Yes, only if `VERIFICATION_PROVIDER=persona` | Startup fails only when persona genuinely selected and key missing |
| `PERSONA_TEMPLATE_ID` | Optional | Yes, only if persona selected | Same as above |
| `PERSONA_WEBHOOK_SECRET` | Optional | Yes, only if persona selected | Same as above — prevents a state where webhooks can never validate |
| `PERSONA_API_BASE_URL` | Optional (URL) | — | Falls back to client default |

### 5.7 Redis (see §13)

| Variable | Req | Prod-required | Fail-closed |
|---|---|---|---|
| `REDIS_URL` | Optional at schema level | **Yes, unconditionally required in production** (env.ts lines 1064-1071) | Startup fails in prod; dev/test/CI fall back to correct in-memory implementations |

### 5.8 Cron (see §12)

| Variable | Req | Prod-required | Fail-closed |
|---|---|---|---|
| `CRON_SECRET` | Optional | Not enforced at env.ts level; enforced per-route | Every cron route returns 503 "not configured" rather than skipping auth |

### 5.9 SMS / Fraud & Trust Signal / Geocoding / Search (swappable-provider pattern)

All of the following follow the identical documented pattern: a `.catch()`-guarded selector defaults to a network-free/no-op implementation on any unset or invalid value, and credentials are optional at the schema level but required by `superRefine` only once the real provider is *validly* selected.

| Subsystem | Selector | Default | Credentials | Prod-required only if |
|---|---|---|---|---|
| SMS | `SMS_PROVIDER` (`mock`\|`twilio`) | `mock` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | `SMS_PROVIDER=twilio` |
| Device fingerprint fraud signal | `FRAUD_DEVICE_FINGERPRINT_PROVIDER` (`null`\|`fingerprintjs`) | `null` | `FINGERPRINTJS_SECRET_API_KEY`, `FINGERPRINTJS_REGION`, `FINGERPRINTJS_TIMEOUT_MS` | provider=`fingerprintjs` |
| VPN/proxy fraud signal | `FRAUD_VPN_PROXY_PROVIDER` (`null`\|`ipqs`) | `null` | `IPQS_API_KEY`, `IPQS_TIMEOUT_MS` | provider=`ipqs` |
| Phone reputation fraud signal | `FRAUD_PHONE_REPUTATION_PROVIDER` (`null`\|`twilio_lookup`) | `null` | reuses Twilio SID/token above | provider=`twilio_lookup` |
| Geocoding | `GEOCODING_PROVIDER` (`STATIC`\|`MAPBOX`\|`GOOGLE`\|`HERE`\|`OSM`) | `STATIC` (no network call ever) | `MAPBOX_API_KEY`, `GOOGLE_GEOCODING_API_KEY`, `HERE_API_KEY` | Not enforced in prod superRefine at all — a real provider without its key silently degrades to STATIC even in production (see §22 Finding) |
| Search | `SEARCH_PROVIDER` (`none`\|`meilisearch`\|`typesense`) | `none` → functional `InMemorySearchProvider` | `MEILISEARCH_HOST/_API_KEY`, `TYPESENSE_HOST/_API_KEY` | Not enforced in prod superRefine — degrades to in-memory even in production if engine unreachable |

### 5.10 Observability / Tracing / Feature Flags / Ops

| Variable | Req | Prod-required | Fail-closed |
|---|---|---|---|
| `SENTRY_DSN` | Optional | **Yes — unconditionally required in production** | Startup fails without it in prod (Module 39) |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Not enforced | Browser errors simply unreported if unset; server reporting unaffected |
| `SENTRY_ENVIRONMENT` | Optional | — | Falls back to `NODE_ENV` |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional (0-1) | — | Defaults to 0 |
| `TRACING_ENABLED` | Optional (default off) | — | Opt-in; OpenTelemetry SDK never imported when off |
| `TRACING_EXPORTER` (`console`\|`otlp`\|`none`) | `.catch("console")` | `OTEL_EXPORTER_OTLP_ENDPOINT` required if `TRACING_ENABLED=true` AND exporter=`otlp` | Degrades safely otherwise |
| `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_HEADERS` | Optional | Conditional (see above) | — |
| `FEATURE_FLAGS_ENABLED` | `.catch("true")` | — | Kill switch; invalid value degrades to "enabled" |
| `FEATURE_FLAGS_CONFIG` | Optional JSON | — | Malformed JSON logged and ignored, never fatal |
| `HEALTH_CHECKS_ENABLED`, `CIRCUIT_BREAKER_*` | Optional/`.catch()` | — | Pure observability, safe in-process defaults |
| `EVENT_QUEUE_ENABLED`, `QUEUE_CONCURRENCY`, `QUEUE_MAX_ATTEMPTS` | Optional/`.catch()` | — | Defaults to synchronous in-process event bus |
| `CACHE_KEY_PREFIX`, `CACHE_BYPASS_ENABLED` | Optional | — | Safe defaults |
| `BACKUP_ENABLED` and 5 related `BACKUP_*` vars | Optional/`.catch()`, default off | — | Opt-in self-hosted backup machinery; irrelevant to a managed-Postgres deployment |
| `READ_REPLICAS_ENABLED` and 8 related `READ_REPLICA_*` vars | `.catch("false")` default | `DATABASE_REPLICA_URLS` required if `READ_REPLICAS_ENABLED=true` | Opt-in; unset = reads/writes through `DATABASE_URL` alone, unchanged behavior |
| `RECONCILIATION_AUTOMATION_ENABLED`, `RECONCILIATION_SCHEDULE_*` | Optional/`.catch()` | — | Opt-out scheduling of an already-safe-to-run reconciliation use case |
| `GDPR_CLOUDINARY_PURGE_*` (4 vars) | `.catch()` operational tuning | — | Bounded batch/retry defaults |
| `REALTIME_*` (5 vars) | `.catch()` | — | SSE/WebSocket tuning knobs, safe defaults |
| `ANALYTICS_*` (3 vars) | `.catch()`/optional | — | Dashboard cache/refresh tuning |
| `LOAD_TEST_*` (6 vars) | `.catch()`, default off | — | Admin-only capacity-report gate; cross-field consistency enforced by its own `superRefine` |

**Total distinct environment variables defined in the schema: ~100** (counted directly from `env.ts`'s `z.object({...})` literal). Every one of them is validated at the same single boundary; none are read via raw `process.env` elsewhere in application code (spot-checked against the file lists gathered in §6-§14 below — every consuming file imports `env` from `@/infrastructure/config/env`, not `process.env` directly, with the sole documented exception of `env.ts` itself and `isProductionRuntime`'s pre-`env`-availability check).

### 5.11 NEXT_PUBLIC_* (client-bundled) inventory

Only two `NEXT_PUBLIC_*` variables exist in the schema: `NEXT_PUBLIC_APP_URL` (required, used for building absolute links — password reset, verification, Stripe onboarding redirect, site SEO metadata) and `NEXT_PUBLIC_SENTRY_DSN` (optional, browser error reporting — `src/app/error.tsx`). No other secret or credential is exposed to the client bundle; `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (client) are deliberately kept as two separate variables per env.ts's own doc comment, preventing accidental server-secret leakage into the browser bundle.

### 5.12 Local `.env*` files — presence/shape only (no values read)

| File | Exists | Var count | Notes |
|---|---|---|---|
| `.env.example` | Yes | ~100, fully documented, template values only | Committed to git, safe |
| `.env` | Yes (gitignored) | 22 vars (core subsystem only — Stripe/Cloudinary/Resend/Auth/DB/OAuth) | Not committed |
| `.env.local` | Yes (gitignored) | Same 22 vars as `.env` | Not committed |
| `.env.production` | Yes (gitignored) | 24 vars (adds `AUTH_TRUST_HOST`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`) | Not committed; still only the core subsystem — none of the ~80 optional operational vars are set, meaning they all run on code-level defaults if this file were used as-is |
| `.env.test` | Yes (gitignored) | 65 vars (the fullest local file — includes ops/observability/backup/replica vars for test-harness coverage) | Not committed |
| `.env.test.local` | Yes (gitignored) | 0 real vars — file content is a placeholder comment only, explicitly documented as "no real secret in this file" | Not committed |

`.gitignore` confirmed to exclude `.env`, `.env.local`, `.env.development.local`, `.env.test.local`, `.env.production.local`, and `.env.production` explicitly, plus `/node_modules` and `/.next/`. **Correction after direct verification:** `.env.example` **and `.env.test` are both tracked in git** (`git ls-files | grep '^\.env'` returns exactly these two). `.env.test` being committed is intentional and safe, not a leak — every sensitive field in the tracked `.env.test` (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `CLOUDINARY_API_SECRET`, `AUTH_SECRET`, `PERSONA_API_KEY`, `TWILIO_AUTH_TOKEN`) was independently verified this pass to be a **literal empty string (`""`, 2 characters including the quotes)**, not a real or realistic-looking credential — confirmed via `awk -F= '{print length($2)}'` against each field name without ever printing the value itself. The five other `.env*` files (`.env`, `.env.local`, `.env.production`, `.env.test.local`, and the *values* inside `.env.test`) are correctly gitignored/empty and not committed.


## 6. External Integration Audit (Database/Prisma Production Configuration)

**`DATABASE_URL` handling:** `prisma/schema.prisma` (lines 29-33) declares `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` — standard Prisma env-driven configuration, validated at the application layer by `env.ts`'s `z.string().min(1)` (fails startup if empty) but **not** shape-validated as a URL (deliberately — Postgres connection strings carry a query string Prisma's own parser handles, per `DATABASE_REPLICA_URLS`'s own doc comment applying the same reasoning).

**SSL:** No `sslmode` is hardcoded anywhere in `schema.prisma`, `prisma/client.ts`, or `env.ts` — SSL/TLS enforcement for the production database connection is entirely a property of the `DATABASE_URL` connection string itself (e.g. `?sslmode=require`), which is operator/Vercel-dashboard configuration, not application code. **EXTERNAL CONFIGURATION NOT VERIFIABLE** from this repository — must be confirmed the real production `DATABASE_URL` (in Vercel's dashboard or the managed Postgres provider's connection string) includes `sslmode=require` (or stronger) before go-live.

**Connection pooling / serverless compatibility:** `src/core/infrastructure/database/prisma/client.ts` uses the standard Prisma-recommended `globalThis`-memoized singleton pattern to avoid exhausting the connection pool across Next.js dev-mode hot reloads. Its own doc comment (confirmed by cross-reference to `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md` §15, "Distributed deployment considerations") states explicitly: *"The app has no serverless-specific complications beyond the standard Prisma connection pooling guidance... since it's deployed as a long-running `next start` process, not a per-invocation serverless function."* This is an important, verifiable architectural fact: **the production Dockerfile/docker-compose target a long-running Node process (`node server.js` from Next's standalone output), not Vercel serverless functions per se** — if the actual production deployment target is Vercel's serverless/Edge functions (as `vercel.json`'s presence and the task's "Vercel deployment target" baseline both suggest) rather than the containerized long-running deployment this code's own comments describe, the connection-pooling story changes materially: serverless functions each get a fresh connection pool per cold start, and a managed Postgres provider without a pooler (e.g. PgBouncer, Prisma Accelerate, or the provider's own built-in pooler such as Supabase's/Neon's) can exhaust its connection limit under concurrent invocations. **No `pgbouncer=true` / `connection_limit` query-string convention, no Prisma Accelerate/Data Proxy wiring, and no PgBouncer service is referenced anywhere in the repository.** This is a genuine open question this audit cannot resolve from code alone: **REQUIRES VERCEL DASHBOARD / DEPLOYMENT-TARGET VERIFICATION** — confirm whether production actually runs as the Dockerized long-running process (in which case today's pooling story is correct as documented) or as Vercel serverless functions (in which case a pooling layer — PgBouncer, Accelerate, or a provider-native pooler — should be added to `DATABASE_URL` before go-live). See §22 Finding.

**Migration deploy mechanism:** `Dockerfile`'s own doc comment states migrations are **deliberately not run automatically** by the container entrypoint — "multiple replicas starting concurrently must never race to apply the same migration" — and must be run as an explicit separate step (`npm run prisma:migrate:deploy`, i.e. `prisma migrate deploy`). `.github/workflows/ci.yml` runs exactly this (`Prisma migrate (test DB)` step) plus `npx prisma migrate status` as a verification step, against the CI `postgres:16-alpine` service container. **No GitHub Actions step runs `prisma migrate deploy` against a real production database** — CI only migrates its own ephemeral test database. A production migration step (as part of a deploy pipeline, Vercel build hook, or manual operator command) is not present anywhere in this repository — **EXTERNAL CONFIGURATION NOT VERIFIABLE**, consistent with the deliberate design that migrations are an explicit, separate, non-automatic deployment action.

**CI DB usage / test DB separation:** `.github/workflows/ci.yml` provisions its own `postgres:16-alpine` service container scoped to the job, seeded with `POSTGRES_DB: maestroya_test`, and sets `DATABASE_URL`/`TEST_DATABASE_URL` to point at it — fully isolated from any production or shared database. `tests/test-utils/db/test-database-url.ts` (referenced by `.env.example`'s own `TEST_DATABASE_URL` comment, not independently re-opened this pass) is documented to actively refuse any hostname resembling a managed/hosted provider (including Supabase) via `UnsafeTestDatabaseUrlError`, and to require the database name contain `"test"` — a defense-in-depth guard against a real-DB test run accidentally targeting a production instance. This is a strong, code-enforced production/test database separation and was independently corroborated by both `.env.example`'s comment and `.env.test`'s own committed comment referencing the same safety guard.


## 7. Stripe Audit

**Configuration:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENTS_WEBHOOK_SECRET` are all unconditionally required at the schema level (`z.string().min(1)`) in **every** environment, including local dev — a deliberate, documented trade-off (env.ts's own comment: "there is no environment-specific wiring to make them optional in dev... this preserves that existing behavior"). `STRIPE_CONNECT_CLIENT_ID` is optional (Connect OAuth onboarding link generation fails at call time, not startup, if unset). `STRIPE_DISPUTE_SYSTEM_USER_ID` is an optional UUID — when unset, a LOST chargeback dispute is still durably recorded, but its financial settlement is deferred to manual review and logged as an `Error` (`process-stripe-dispute-webhook.use-case.ts` line 289) rather than silently mis-attributed to no one.

**Client construction:** `src/core/infrastructure/payments/stripe/client.ts` — a single singleton, `apiVersion` pinned to `"2025-02-24.acacia"` (explicit API-version pinning, good practice — protects against Stripe's rolling default-version changes silently altering response shapes). Server-only (`import "server-only"`).

**Test-vs-live key protection:** `env.ts`'s production `superRefine` (lines 889-898) explicitly rejects any `STRIPE_SECRET_KEY` starting with `sk_test_` or `STRIPE_PUBLISHABLE_KEY` starting with `pk_test_` when `NODE_ENV=production` — a hard, code-enforced guarantee that test-mode Stripe keys can never reach a production runtime. This is a strong, verifiable control.

**Connect onboarding:** `stripe-connect/` use cases (`create-stripe-connected-account`, `create-stripe-login-link`, `create-stripe-onboarding-link`, `get-stripe-account-status`) and `stripe-connect-gateway.ts` implement standard Connect Express onboarding. Not independently re-executed against a live Stripe account this pass (no credentials, no network calls permitted) — code shape reviewed only.

**Webhook signature verification — both endpoints:**
- `/api/webhooks/stripe` (Connect-scoped, `stripe-connect-webhook-verifier.ts`): uses `stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)` — Stripe SDK's own HMAC verification over the exact raw body, performed **before** any JSON parsing or business-logic trust (raw body read via `request.text()`, never `request.json()`). Missing/invalid signature → `{valid:false}` → HTTP 401, generic error message (never distinguishes failure reason, preventing a forged-request attacker from narrowing down what's wrong). **Fail-closed: CONFIRMED.**
- `/api/webhooks/stripe-payments` (platform-scoped PaymentIntent/charge events, `stripe-payment-webhook-verifier.ts`): identical pattern, separate secret (`STRIPE_PAYMENTS_WEBHOOK_SECRET`), separate route — deliberately not merged with the Connect endpoint (documented architectural reason: different event scope, "Events from: Connected accounts" vs platform events). **Fail-closed: CONFIRMED.**

**Idempotency:** Both webhook use cases (`ProcessStripeConnectWebhookUseCase`, `ProcessCustomerPaymentWebhookUseCase`) claim `(PROVIDER, event.id)` via an `ExternalWebhookEventRepository` before any processing — confirmed by both route files' own doc comments describing this exact mechanism; a duplicate delivery (Stripe retry or concurrent delivery) is acknowledged 200 with zero re-processing. This is the correct idempotency pattern for webhook-driven financial state.

**Refunds/disputes:** `stripe-disputes/process-stripe-dispute-webhook.use-case.ts`, `reverse-affiliate-commission-on-stripe-dispute-lost.subscriber.ts`, `create-credit-note-on-stripe-dispute-lost.subscriber.ts` implement a LOST-chargeback → commission reversal → credit-note chain. Reviewed at the file-existence/wiring level only this pass; deep correctness of the financial math was previously audited by Module 96/100/prior reports and is out of this module's scope to re-derive.

**Payouts/transfers:** `stripe-transfer-gateway.ts`, `stripe-express-payout-provider.ts` (Module 76 — Professional Payout Execution) implement Connect Transfers; `transfer.created` webhook events are mapped and correlated back to `payoutId`/`jobId` via Transfer metadata (`stripe-connect-webhook-verifier.ts` lines 128-151).

**Classification: A — Implemented + production credential missing.** Stripe integration is comprehensively implemented (Connect onboarding, webhooks with signature verification and idempotency, disputes, payouts) but no live/production Stripe key is present in any local env file (all fields empty or test-placeholder), and Vercel dashboard configuration cannot be verified from this repository. **REQUIRES STRIPE DASHBOARD + VERCEL DASHBOARD VERIFICATION**: real `sk_live_`/`pk_live_` keys, both live webhook endpoints registered at their exact documented URLs and event-type subscriptions (`/api/webhooks/stripe` with Connect scope, `/api/webhooks/stripe-payments` platform-scoped), and `STRIPE_DISPUTE_SYSTEM_USER_ID` set to a real admin/system user id before go-live.

## 8. Resend Audit

**Implementation:** `src/core/infrastructure/email/resend-email-sender.ts` (28 lines) — a minimal, correct `EmailSender` port implementation wrapping the `resend` npm SDK. Constructor takes `apiKey`/`from` (injected via `env.RESEND_API_KEY`/`env.EMAIL_FROM` at the compose-root, not opened this pass but consistent with the manual-DI convention seen throughout). `send()` awaits `resend.emails.send(...)` and throws a wrapped `Error` if Resend returns an `error` object — a synchronous, propagating failure rather than a silently swallowed one, which is correct fail-closed behavior for a transactional email (verification/password-reset) failing to send: the calling use case sees the exception.

**Configuration:** `RESEND_API_KEY` and `EMAIL_FROM` are both unconditionally required at schema level, every environment. `.env.example`'s own comment: "Used to send real verification/password-reset emails (RegisterUserUseCase, RequestPasswordResetUseCase)." `EMAIL_FROM` default template in `.env.example` is `"MaestroYa <noreply@maestroya.es>"` — implies the production sending domain `maestroya.es` must have SPF/DKIM/DMARC records configured in Resend's dashboard for deliverability; this is **EXTERNAL CONFIGURATION NOT VERIFIABLE** from this repository.

**Transactional flows using it:** confirmed by import-chain naming only this pass (not re-opened line-by-line): registration verification, password reset request — `.env.example`'s own comment names exactly these two use cases. Prior module reports (§4 above) reference additional notification/payout/dispute email flows through a broader `channels/email-notification-channel.ts` abstraction (found in the `NEXT_PUBLIC_` grep in §5.11) — not re-verified in depth this pass.

**Error handling:** the `send()` method's thrown error propagates to whatever use case invoked it; no retry/backoff logic is visible in this file (a single Resend API call, no queue wrapping visible here) — if a broader event-driven notification path exists (`EVENT_QUEUE_ENABLED`/BullMQ per §5.10), it may add retry semantics at that layer, but the sender class itself is a simple pass-through with no retry. **NOT VERIFIED THIS PASS** whether email delivery failures are retried anywhere in the pipeline.

**Classification: A — Implemented + production credential missing.** `RESEND_API_KEY` is empty/placeholder in every local env file; no production key present. **REQUIRES RESEND DASHBOARD VERIFICATION**: real API key, verified sending domain (`maestroya.es`) with SPF/DKIM/DMARC configured, before go-live.


## 9. Cloudinary Audit

**Configuration:** `src/core/infrastructure/storage/cloudinary/client.ts` — `cloudinary.config({ cloud_name, api_key, api_secret, secure: true })`, all three sourced from `env`, all three unconditionally required at schema level in every environment. `secure: true` enforces HTTPS delivery URLs. `import "server-only"` present — correctly server-bounded.

**Usage surfaces:** `avatar-upload-service.ts` (public, low-sensitivity), `request-photo-upload-service.ts` (public, service-request photos), `verification-document-upload-service.ts` and `company-verification-document-upload-service.ts` (identity/business verification documents — sensitive), `verification-document-deletion-service.ts`, plus `cloudinary-manifest-storage-backup-provider.ts` (Module 54 backup) and `retry-pending-cloudinary-purges.use-case.ts` / `gdpr-cloudinary-purge-policy.ts` (Module 94 GDPR erasure retry).

**Signed URLs / private-asset delivery — MEDIUM finding re-confirmed (cross-referenced from Module 103):** Module 103's IDOR audit (`MaestroYa_Module_103_IDOR_Authorization_Audit.md`, Finding 1, lines 352-359) found that verification documents are uploaded with Cloudinary's `type: "private"` delivery mode (the correct choice), but that **no code anywhere in `src/core/**` generates a Cloudinary signed/authenticated delivery URL** (`private_download_url`, `utils.sign`, `api_sign_request`, or equivalent) — the admin review UI renders the raw, unsigned `secure_url` directly as an `<a href>`. This audit independently re-ran the same class of search this pass (`grep -rn "cloudinary" src/core/infrastructure/storage/cloudinary` file listing plus a targeted read of `client.ts`) and found no new signing utility added since Module 103 — **the finding is still open**. As Module 103 itself correctly notes, this is not an IDOR (a `type: "private"` asset without a valid signature is refused by Cloudinary for every caller, not selectively bypassable), but it is a likely **functional break**: admin verification-document review may not currently render any document at all in production. **Classification: C — Integration partially implemented** (upload/deletion paths work; the delivery/viewing path is unverified and plausibly broken). **REQUIRES A LIVE CLOUDINARY SANDBOX TEST** to confirm whether the current unsigned-link behavior renders for an admin today (Module 103's own recommendation, carried forward here — Module 106 in that report's roadmap is explicitly scoped to this).

**Deletion flows:** `verification-document-deletion-service.ts` (explicit user/admin-triggered removal) and the GDPR purge retry pipeline (`retry-pending-cloudinary-purges.use-case.ts`, cron-driven via `/api/cron/gdpr-cloudinary-purge`, batch-bounded per `GDPR_CLOUDINARY_PURGE_RETRY_BATCH_SIZE`, dead-letters after `GDPR_CLOUDINARY_PURGE_MAX_ATTEMPTS`) both exist and appear reasonably engineered (bounded batches, exponential backoff via `gdpr-cloudinary-purge-policy.ts`, dead-letter escalation for manual review) — not independently re-executed against a live account this pass.

**Classification (credential readiness): A — Implemented + production credential missing.** No `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` is set to a real value in any local env file. **REQUIRES CLOUDINARY DASHBOARD VERIFICATION**: real account credentials, and separately, resolution of the signed-URL gap above (a code-level fix, tracked as Module 106 in Module 103's own report — **not attempted or fixed by this audit**, per this module's read-only mandate).

## 10. Persona Audit

**Configuration:** `VERIFICATION_PROVIDER` (`"manual"` default \| `"persona"`) follows the swappable-provider pattern (§5.9) — `"manual"` keeps the pre-existing Module 17 manual document-upload/admin-review workflow as a fully functional, Persona-independent fallback; this is explicitly documented as not a degraded mode but a complete alternate path. `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET` are all optional at schema level but all three (including the webhook secret, added specifically per Module 70.1's own audit finding) are required by `superRefine` once `VERIFICATION_PROVIDER=persona` is validly selected in production — confirmed at env.ts lines 942-970.

**Webhook verification (`persona-verification-provider.ts::webhookValidation`):** implements Persona's documented `Persona-Signature: t=<timestamp>,v1=<hmac>` scheme correctly: HMAC-SHA256 of `${timestamp}.${rawBody}` computed only after (a) both `t` and `v1` are present, (b) the timestamp is a clean integer within a ±5-minute replay window (`WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS`), and (c) the provided signature is clean hex of the expected length — all before `timingSafeEqual` is ever called, preventing both a malformed-signature bypass and a timing side-channel. This is a well-constructed, defense-in-depth implementation, materially more careful than a typical HMAC-compare-only webhook handler. **Fail-closed: CONFIRMED** — `!this.webhookSecret || !signatureHeader` returns `{valid:false}` immediately (line 189), meaning a deployment with `VERIFICATION_PROVIDER=persona` but a missing webhook secret would have every webhook rejected — exactly the "silent, fail-closed-forever misconfiguration" scenario the code's own doc comment says Module 70.1 was written to prevent (and which the production `superRefine` now independently guards against by requiring the secret at startup).

**Fallback / manual path:** `"manual"` is the default and does not depend on `VerificationProvider` at all — genuinely independent, not merely "Persona with a null adapter." Confirms this integration is **optional**, not mandatory, for launch.

**Data minimization:** the class's own doc comment states only `providerVerificationId`/`providerStatus`/`providerSyncedAt` are ever persisted — document images, extracted fields, and selfies remain solely in Persona's systems. Not independently re-verified against the Prisma schema this pass, but consistent with the schema comment cross-referenced in that same doc block.

**Classification: E — Optional / not a launch blocker.** Persona is fully implemented with correct fail-closed webhook handling, but the platform ships a complete, independent manual verification workflow as the default — Persona activation is a deliberate future upgrade, not a go-live requirement. If Persona **is** intended for launch, credentials are absent (all empty) and it would reclassify to A.

## 11. Authentication Audit

**Session strategy:** Auth.js v5, JWT session strategy (required — the Credentials/email-password provider is incompatible with Auth.js's "database" session strategy), `PrismaAdapter` retained for OAuth account linking. Default session `maxAge` = 1 day; a `rememberMe` flag extends the JWT's own `exp` claim to 30 days at issuance (not a separate cookie config) — implemented in the `jwt` callback (auth-config.ts lines 205-208).

**Secrets:** `AUTH_SECRET` required, and independently enforced ≥32 characters in production via `superRefine` (matches `openssl rand -base64 32` / `npx auth secret` output length) — a genuine, code-enforced guard against a weak/placeholder production session secret, a real-world common vulnerability class this schema explicitly calls out in its own comment.

**Cookie/domain security:** `AUTH_URL` required and must be `https://` in production (enforced). `AUTH_TRUST_HOST` defaults to `"true"`, required explicitly for any non-Vercel host (self-hosted Docker/reverse-proxy) per Auth.js v5's own `UntrustedHost` behavior — correctly documented and wired. Auth.js v5's own defaults set `secure`/`sameSite`/`httpOnly` cookie flags automatically based on the `AUTH_URL` protocol (framework-level, not independently re-verified in this codebase's config, since no custom `cookies` override was found in `auth-config.ts`).

**OAuth providers:** Google, Apple, Facebook all wired via `next-auth/providers/*`, credentials sourced from `env.*` and all optional (§5.2) — a provider left unconfigured does not block startup, only fails silently at sign-in time for that specific provider. **REQUIRES OAUTH DASHBOARD VERIFICATION** for each provider (Google Cloud Console, Apple Developer, Meta for Developers) if any of the three is intended to be live at launch — none of the three has a configured value in any local env file today.

**Rate limiting / brute-force protection:** `auth-config.ts`'s `authorize()` callback enforces `LOGIN_BY_EMAIL` and `LOGIN_BY_IP` rate limits via `AntiAbuseService.enforceRateLimit` **before any password comparison**, and auto-escalates a breach to a 30-minute `TEMPORARILY_BLOCKED` account restriction (`escalateToTemporaryBlock`) — a real, code-verified defense against both single-account brute force and distributed credential stuffing. Deliberately returns `null` (not a distinguishable error) for every rejection reason (unknown email, wrong password, suspended, rate-limited) to avoid leaking which case occurred to a probing attacker. This rate limiting is itself backed by `RateLimitRepository`, which (per §13) is Redis-backed in production with an independent double fail-closed guarantee against silently degrading to per-instance in-memory limiting.

**CSRF:** Auth.js v5 provides built-in CSRF token handling for its own `/api/auth/*` routes (framework default, not independently re-verified in application code this pass — no custom CSRF bypass or override was found).

**Prod vs dev differences:** entirely governed by the single `superRefine` block in `env.ts` — `AUTH_SECRET` length, `AUTH_URL`/`NEXT_PUBLIC_APP_URL` HTTPS enforcement, Stripe test-key rejection, `SENTRY_DSN` requirement, and `REDIS_URL` requirement are the production-only hard gates; every other difference (SMS/verification/fraud providers) is opt-in-by-configuration rather than environment-branched code.

**Classification: B — Implemented + production configuration unknown (needs dashboard verification)** for OAuth providers specifically (code is correct and complete; whether Google/Apple/Facebook apps are registered with correct production redirect URIs cannot be verified from this repository). Core email/password auth plus its rate-limiting/lockout defenses are **fully implemented and credential-independent** (no external dashboard dependency) — this half is launch-ready as code, contingent only on `AUTH_SECRET`/`AUTH_URL` being set to real production values (currently placeholder/empty in every local env file — **A** for those two specifically).


## 12. Cron Audit

**Vercel Cron configuration (`vercel.json`):** four scheduled jobs, all pointing at `/api/cron/*` routes:

| Path | Schedule | Cadence |
|---|---|---|
| `/api/cron/expire-workflows` | `0 3 * * *` | Daily 03:00 UTC |
| `/api/cron/reconciliation-run` | `0 */6 * * *` | Every 6 hours |
| `/api/cron/gdpr-cloudinary-purge` | `*/30 * * * *` | Every 30 minutes |
| `/api/cron/referral-affiliate-maintenance` | `0 4 * * *` | Daily 04:00 UTC |

**Shared authorization mechanism:** every one of the four routes independently performs the identical two-step check (confirmed by direct `grep` across all four `route.ts` files):
1. `if (!env.CRON_SECRET) { ...log reason "CRON_SECRET is not configured"...; return 503 }` — **fail-closed when the secret itself is unconfigured**, rather than skipping the check (a common anti-pattern this codebase explicitly avoids).
2. `if (!isValidCronAuthHeader(authHeader, env.CRON_SECRET)) { ...401... }` — a **timing-safe** comparison (`src/core/infrastructure/auth/cron-auth.ts`, using `node:crypto`'s `timingSafeEqual` with a `Buffer.byteLength` length check performed first to avoid `timingSafeEqual`'s own length-mismatch throw). This module (95 — API Security Hardening, per its own doc comment) explicitly replaced a prior `!==` string comparison specifically to close a timing side-channel — a genuine security hardening pass, independently corroborated by its detailed doc comment explaining the threat model.

`CRON_SECRET` itself is optional at the `env.ts` schema level (not enforced by the production `superRefine` block) — meaning a production deployment *can* start with `CRON_SECRET` unset; the consequence is every cron invocation returning 503 rather than any cron job silently running unauthenticated or the app failing to boot. This is a deliberate, documented design choice ("Leave unset in local dev; the route responds 503 without it rather than skipping the check" — `.env.example`'s own comment) rather than an oversight, and it correctly fails closed rather than open. **Operational risk, not a security gap:** if `CRON_SECRET` is never configured in the Vercel production environment, all four scheduled jobs (workflow expiration, financial reconciliation, GDPR purge retries, referral/affiliate maintenance) silently never run (503 each time, only visible in logs) — **this is a launch-blocking operational configuration item, not a code defect** (see §23).

**Business coverage:** reconciliation (financial-drift detection), GDPR erasure completion (legal-compliance-critical), workflow expiration (state-machine hygiene), and referral/affiliate maintenance are all represented — no orphaned "should have a cron but doesn't" cases were found in this pass, though this audit did not attempt to enumerate every use case that plausibly *should* be scheduled.

**Classification: A — Implemented + production credential missing.** `CRON_SECRET` is empty in every local env file. **REQUIRES VERCEL DASHBOARD VERIFICATION**: `CRON_SECRET` must be set in the Vercel project's production environment variables, matching what Vercel Cron is documented to automatically send as `Authorization: Bearer $CRON_SECRET`.

## 13. Redis Audit

**Where used:** `redis-client.ts`/`redis-client-factory.ts` (shared connection singleton, `redis://`/`rediss://` TLS both supported per the URL scheme), `redis-cache-provider.ts`/`redis-cache-service.ts` (Module 46 caching layer), `redis-job-store.ts` (Module 45 background jobs / BullMQ-style queue), `redis-lock-service.ts` (distributed locking), `redis-rate-limit-repository.ts` (Module 44/82 rate limiting).

**In-memory fallback:** `getRedisClient()` (`redis-client-factory.ts`) returns `null` when `REDIS_URL` is unset — documented as the intended default for local dev, most CI runs, and any genuinely single-instance deployment. Every consumer factory (`cache-service-factory.ts`, `rate-limit-repository-factory.ts`, `lock-service-factory.ts` — the latter two named directly by other files' doc comments, not independently re-opened this pass beyond the rate-limit factory) treats `null` as "fall back to the in-memory/no-op implementation," never as an error, in non-production. **Limit of the in-memory fallback:** by its nature it is per-process/per-instance — correct for a single-instance deployment, but in a horizontally-scaled multi-instance production deployment it would silently multiply every rate limit by the instance count (an implicit security/business-logic weakening, not a crash) — this exact risk is what motivated the production-only hard requirement below.

**What depends on Redis:** rate limiting (confirmed, `redis-rate-limit-repository-factory.ts` reviewed in full), distributed locking (named, not re-opened), caching (named, not re-opened), and the BullMQ-backed event queue when `EVENT_QUEUE_ENABLED=true` (named, not re-opened).

**Fail-closed guarantee — double-enforced, genuinely verified:**
1. `env.ts`'s production `superRefine` (lines 1064-1071) unconditionally requires `REDIS_URL` in production — no opt-out, unlike every other provider check in the same block, which are all conditional on a selector being validly set. The code's own comment: *"unlike the `SMS_PROVIDER=twilio`-style checks, this one is unconditional in production... there is no 'Redis disabled' opt-out for rate limiting, the same way there is no 'error reporting disabled' opt-out for Sentry."*
2. `rate-limit-repository-factory.ts` (lines 36-42) **independently** throws `"Refusing to create an in-memory rate limiter in production — REDIS_URL must be configured... This should be unreachable: env.ts already requires REDIS_URL in production"` if `redisClient` is still falsy at factory-construction time while `isProduction` is true.

This is a genuine defense-in-depth pattern (both layers independently verified by direct file read, not merely asserted by a comment) rather than a single point of failure disguised as "belt and suspenders."

**Classification: A — Implemented + production credential missing** for rate limiting specifically (mandatory in production, per above) — `REDIS_URL` is empty in every local env file. **REQUIRES a provisioned production Redis instance (managed Redis/Upstash/ElastiCache/etc.) with a `rediss://` TLS URL** before a production deployment can start at all — this is not optional infrastructure, the application will refuse to boot in `NODE_ENV=production` without it. Caching/locking/event-queue Redis usage is **E — optional**, degrading gracefully.

## 14. Other External Services

Discovered via the full `env.ts` variable inventory (§5) and targeted `find`/`grep`:

- **Sentry (error reporting):** `sentry-client.ts`, `sentry-error-reporter.ts`, `sentry-failure-reporter.ts` — required in production (`SENTRY_DSN`), gracefully inert everywhere else, browser DSN kept separate (`NEXT_PUBLIC_SENTRY_DSN`, optional). Classification: **A** (implemented, no production DSN present in any local env file).
- **Twilio (SMS):** swappable-provider pattern, `mock` default, reused for the phone-reputation fraud signal too. Classification: **E** (optional — mock is a complete, functional default).
- **OAuth providers (Google/Apple/Facebook):** see §11. Classification: **B** for each (implemented, dashboard app registration unverifiable).
- **Geocoding (Mapbox/Google/HERE/OSM):** `STATIC` default is network-free and explicitly documented as a "hard safety guarantee." Classification: **E**.
- **Search (Meilisearch/Typesense):** `none` default uses a fully functional in-memory provider. Classification: **E**.
- **Distributed tracing (OpenTelemetry):** opt-in, `console` exporter default, `otlp` requires an endpoint (enforced in prod only if both tracing and otlp are explicitly selected). Classification: **E**.
- **FingerprintJS / IPQS (fraud/trust signals):** `null` default, no outbound call unless explicitly and validly selected with credentials. Classification: **E**.
- **Feature flags:** in-process, no external service. Classification: **E** (not an external integration at all).
- **Backup & Disaster Recovery (Module 54):** filesystem-based (`BACKUP_STORAGE_DIR`), opt-in, intended for self-hosted deployments where a managed Postgres provider's own snapshot capability is absent. Not an external API integration. Classification: **E**.
- **Read Replicas (Module 55):** opt-in, `DATABASE_REPLICA_URLS` comma-separated Postgres connection strings — infrastructure config, not a third-party API. Classification: **E**.
- No analytics platform (e.g. Segment, Mixpanel, GA), no maps/geocoding beyond the above, no additional monitoring/APM vendor, and no payment provider other than Stripe were found anywhere in the codebase or env schema.

## 15. Production/Test Separation

- **Stripe:** hard-enforced by code (`superRefine` rejects `sk_test_`/`pk_test_` in production) — the strongest guarantee in this audit; not merely a convention.
- **CI:** `.github/workflows/ci.yml` uses explicit, clearly-named placeholder values (`sk_test_placeholder`, `re_ci_placeholder`, `ci-only-placeholder-secret`, `whsec_placeholder`) for every credentialed variable, and a placeholder `SENTRY_DSN` scoped to `o0.ingest.sentry.io` (Sentry's own documented no-op org id convention) — all clearly non-functional, never real. CI's `DATABASE_URL` points only at its own ephemeral service container.
- **Docker build stage:** `Dockerfile`'s builder stage sets explicit `ENV` placeholders (`sk_test_build_placeholder`, `build-placeholder`, `build-only-placeholder-auth-secret-32-characters`) with an explicit comment: "Build-time placeholders only. Real production secrets are injected at container runtime via docker-compose.prod.yml -> env_file: .env" — correctly separates build-time (needs *some* valid-shaped value to compile) from runtime (needs the real value) secret handling.
- **Test database:** `tests/test-utils/db/test-database-url.ts` (per its cross-referenced doc comments in `.env.example`/`.env.test`) actively refuses hostnames resembling managed/hosted providers and enforces a `"test"`-containing database name — code-enforced separation, not just convention.
- **No hardcoded dev defaults found that could leak into production:** every optional provider's default (mock SMS, manual verification, STATIC geocoding, none/in-memory search, null fraud signals) is a safe no-op, never a real external call, and every one of these safe defaults is `.catch()`-guarded so a *typo* in production also degrades safely rather than accidentally selecting an unintended real provider.

**No prod/test separation defect was found in this audit.**


## 16. Vercel Audit

**`vercel.json` (repository-visible, VERIFIED IN REPOSITORY):** the file contains only a `crons` array (4 jobs, §12) and a `$schema` reference — no `framework`, `buildCommand`, `installCommand`, `outputDirectory`, `regions`, or `env` block is present. This means Vercel is relying entirely on its own Next.js framework auto-detection for build/install/output commands (Vercel's documented default behavior for a Next.js project with no explicit overrides: `next build` / `npm install` / `.next`) — **VERIFIED IN REPOSITORY only for the crons config**; every other build/deploy setting is **REQUIRES VERCEL DASHBOARD VERIFICATION** since Vercel project settings (Node.js version override, root directory, environment variables per environment, custom domains, deployment protection) live in the dashboard and are invisible to this repository. `.nvmrc`/`package.json engines.node` both pin Node 20, which Vercel's auto-detection honors by default — **consistent, but the actual dashboard-configured Node version cannot be independently confirmed from here.**

**Environment variable references:** every variable in §5's inventory is a candidate Vercel needs configured per-environment (Production/Preview/Development) in its dashboard — none of this is expressible in `vercel.json` itself in this codebase (no `env`/`build.env` keys used). **REQUIRES VERCEL DASHBOARD VERIFICATION** for the full ~100-variable set, at minimum the unconditionally-required subset (DATABASE_URL, RESEND_API_KEY, EMAIL_FROM, AUTH_SECRET, AUTH_URL, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PAYMENTS_WEBHOOK_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, NEXT_PUBLIC_APP_URL) plus the production-only-required subset (SENTRY_DSN, REDIS_URL, and CRON_SECRET operationally).

**Cron config:** `VERIFIED IN REPOSITORY` — see §12 table, matches the four route files found in `src/app/api/cron/`.

**Deployment target ambiguity (see §6 and §22 Finding):** the presence of `vercel.json` plus this audit's task baseline both point at a Vercel deployment target, while the `Dockerfile`/`docker-compose.prod.yml` describe a self-hosted, long-running containerized deployment as an equally real, equally documented alternative path ("A real production deployment would typically run Postgres as a managed service... this file is a reference/staging-equivalent production topology"). Both are legitimately supported by the codebase; which one is the *actual* launch target for connection-pooling and cold-start purposes is **REQUIRES VERCEL DASHBOARD / OPERATOR VERIFICATION**, not resolvable from code.

## 17. CI/CD Audit

**`.github/workflows/ci.yml`** — a single workflow, triggered on push/PR to `main`. Steps, in order: checkout → `actions/setup-node@v4` (Node version from `.nvmrc`, npm cache) → `npm ci` → `npm run prisma:generate` → `npm run typecheck` → `npm run lint` → `npx prisma validate` → `npm run prisma:migrate:deploy` (against the job's own ephemeral Postgres service) → `npx prisma migrate status` → `npm run test:unit` → `npm run test:integration` → `npm run test:integration:db` (Module 91 real-Postgres suite, explicit `TEST_DATABASE_URL` env override) → `npm run build`.

**Secrets/env vars referenced:** all explicit, hardcoded placeholder values at the job level (`DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_SECRET`, `AUTH_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `SENTRY_DSN`) — **no GitHub Actions repository/organization secret (`${{ secrets.* }}`) is referenced anywhere in this workflow.** This means CI never touches any real external credential for any service — Stripe, Resend, Cloudinary, Sentry are all fully mocked/placeholder in CI, and no live external API call is made during CI (confirmed: no `curl`/`fetch` to an external host, no service other than the local `postgres:16-alpine` container is started). This is a clean, low-risk CI configuration with no credential-leak surface.

**Node version:** `node-version-file: ".nvmrc"` — consistent with `package.json`/`Dockerfile` pins (20).

**Build step:** `npm run build` (`next build`) is a required, blocking CI step on every PR — meaning `next build` is routinely exercised successfully in CI (though not independently re-confirmed by this sandboxed audit, consistent with Module 104's own finding that this sandbox cannot complete a full `next build` in its time budget — see §4).

**Migration safety in CI:** `prisma migrate deploy` + `prisma migrate status` both run against CI's own ephemeral test database only, never production — correct isolation, matches the Dockerfile's own "migrations are a separate, explicit step" philosophy, just exercised here against a throwaway target.

**No deployment step:** this workflow does not deploy anywhere (no `vercel deploy`, no Docker push/deploy step) — it is a pure CI gate (build+test verification), not a CD pipeline. Actual deployment is presumably handled by Vercel's own GitHub integration (auto-deploy on push/merge), which is **REQUIRES VERCEL DASHBOARD VERIFICATION** — not visible from this repository.

## 18. Docker/Infrastructure Audit

**`Dockerfile`** (86 lines, multi-stage): `deps` (full `npm ci` incl. devDependencies) → `builder` (`next build` with `output: "standalone"`, explicit build-only placeholder `ENV` values for every required secret, `npx prisma generate` then `npm run build`) → `runner` (minimal image: only `.next/standalone`, `.next/static`, `public`, `prisma`; non-root user `nextjs:1001`; `HEALTHCHECK` hitting the app's own liveness endpoint `/api/health`, deliberately liveness not readiness per its own comment, "a transient DB issue must not cause Docker to restart a perfectly healthy process" — a correct, mature distinction). Migrations deliberately not run by the entrypoint (§6).

**`docker-compose.yml`** (not read line-by-line this pass, named "local-dev convenience file — Postgres only" by `docker-compose.prod.yml`'s own comment) and **`docker-compose.prod.yml`** — a "production-shaped" reference topology: `postgres:16-alpine` with a required `POSTGRES_PASSWORD` (`:?POSTGRES_PASSWORD is required` — Compose's own fail-closed syntax, refuses to start without it), health-checked, plus the `app` service built from the production `Dockerfile`, `env_file: .env.production`, health-checked, `depends_on: postgres: condition: service_healthy`. Its own comment is explicit that a real production deployment would typically use a managed Postgres service instead of this containerized instance — this file exists to make the compose file runnable end-to-end for staging/self-hosted use, not as a prescription that production must self-host Postgres.

**Dev-only vs prod-capable:** `docker-compose.yml` = dev-only (Postgres only, app runs via `npm run dev` on host). `docker-compose.prod.yml` + `Dockerfile` = a genuinely prod-capable, non-Vercel self-hosting path (relevant to the deployment-target ambiguity noted in §16). Both are internally consistent and correctly separated by naming convention.

## 19. Fail-Closed Analysis

| Subsystem | Missing-config behavior | Verdict | Evidence |
|---|---|---|---|
| Stripe | `env.ts` `min(1)` — app refuses to start in **any** environment without all 4 required Stripe vars | **FAIL CLOSED** | env.ts lines 203-220 |
| Stripe webhooks | Missing/bad signature → 401, never processed | **FAIL CLOSED** | stripe/route.ts, stripe-payments/route.ts, both verifier adapters |
| Resend | `env.ts` `min(1)` — app refuses to start without `RESEND_API_KEY`/`EMAIL_FROM` in any environment | **FAIL CLOSED** | env.ts lines 84-85 |
| Cloudinary (upload/delete) | `env.ts` `min(1)` — app refuses to start without all 3 vars, any environment | **FAIL CLOSED** | env.ts lines 236-238 |
| Cloudinary (document viewing/signed URLs) | No signing mechanism exists at all — behavior is "asset likely never renders for anyone," not a security bypass | **PARTIAL / LIKELY BROKEN, NOT AN OPEN-ACCESS RISK** | Module 103 Finding 1, re-confirmed §9 |
| Persona | Optional selector; if validly selected, all 3 credentials required at production startup | **FAIL CLOSED (once opted in)** | env.ts lines 942-970 |
| Persona webhooks | Missing secret/header → `{valid:false}` immediately, no attempt to verify | **FAIL CLOSED** | persona-verification-provider.ts line 189 |
| Auth (AUTH_SECRET/URL) | `env.ts` required + production-only length/HTTPS `superRefine` | **FAIL CLOSED** | env.ts lines 180-181, 864-887 |
| OAuth providers (Google/Apple/Facebook) | Not startup-gated; provider registered with empty credentials, fails only at sign-in attempt time | **FAIL OPEN AT STARTUP / FAIL CLOSED AT REQUEST TIME** (soft) | auth-config.ts lines 124-135 |
| Cron routes (all 4) | `CRON_SECRET` unset → every invocation 503, logged reason, never executes | **FAIL CLOSED** | cron-auth.ts + all 4 route.ts files |
| Redis (rate limiting) | Required in production at 2 independent layers (schema `superRefine` + factory-level throw) | **FAIL CLOSED (double-enforced)** | env.ts lines 1064-1071, rate-limit-repository-factory.ts lines 36-42 |
| Redis (cache/lock/queue) | Falls back to correct in-memory/no-op implementation, every environment including production | **FAIL OPEN BY DESIGN (documented, acceptable — non-security-critical)** | redis-client-factory.ts |
| Sentry | Required in production only (`superRefine`); inert elsewhere | **FAIL CLOSED (prod only)** | env.ts lines 906-912 |
| Geocoding / Search / SMS / Fraud signals | `.catch()` to a safe no-op default on any unset/invalid value; **not** enforced in production superRefine unless the real provider was *validly and explicitly* selected | **FAIL SAFE / GRACEFUL DEGRADE BY DESIGN** (intentional — these are optional capabilities, not core trust boundaries) | env.ts throughout §5.9 |

**Overall assessment:** every subsystem that is a genuine trust or financial boundary (Stripe, Auth, cron auth, rate-limiting Redis, webhook signature verification) fails closed, several with double-enforcement. Subsystems that are optional capabilities correctly fail open to a safe no-op rather than blocking startup — a coherent, deliberate design philosophy applied consistently across ~15 modules' worth of accreted configuration, not an accident.

## 20. Secret Safety Check (read-only scan)

**Method:** repository-wide `grep` for `sk_live_`, `sk_test_`, `pk_test_`, `AKIA[0-9A-Z]{16}` (AWS access key pattern), `BEGIN.*PRIVATE KEY`, and non-placeholder `whsec_` occurrences, restricted to source/config/doc file types, explicitly excluding `node_modules`; plus a sampled `git log --all -p -S "sk_live_"` across all 247 commits in the repository's history.

| Pattern | Matches found | Assessment |
|---|---|---|
| `sk_live_` (live Stripe secret key) | 0 in tracked source; 0 in `git log -p -S` across all history | **CLEAN** |
| `sk_test_` (test Stripe secret key) | `tests/unit/.../env-fixture.ts`, `env.test.ts`, `platform-config-env-fixture.ts`, `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md`, `MaestroYa_Audit_Report.md`, `.github/workflows/ci.yml`, `vitest.config*.ts`, `src/core/infrastructure/config/env.ts` (its own doc comment) | All test fixtures, CI placeholders, or documentation prose referencing the pattern by name — **no active credential** |
| `pk_test_` (test Stripe publishable key) | Same file set as above, plus `Dockerfile` (build-only placeholder `ENV`) and `.next/` build-cache artifacts (compiled bundle references to the string literal, an artifact of the codebase's own test fixtures being bundled, not a live key; `.next/` is gitignored, not committed) | **No active credential** |
| AWS access key (`AKIA...`) | 0 | **CLEAN** |
| Private key header (`BEGIN...PRIVATE KEY`) | Only inside `.next/cache/webpack/*.pack` (compiled webpack cache blobs — gitignored build artifacts, not source) | **CLEAN** (no source-level match; build-cache binary blobs not inspected further as they are not committed and not source) |
| `whsec_` (Stripe webhook secret) non-placeholder-named | Every match is inside `tests/unit/**` test fixtures (`whsec_test`, `whsec_payments_test`, `whsec_super_secret`, `whsec_realvalue`) — all self-evidently synthetic test values, several used specifically to assert the value is *not* leaked in a response (`expect(JSON.stringify(result)).not.toContain("whsec_super_secret")`) | **CLEAN — no active credential; test coverage actively defends against leakage** |
| Committed `.env*` files | `.env.example` (template, placeholder values by design) and `.env.test` (all sensitive fields verified this pass to be literal empty strings `""`, not real values) | **CLEAN** |

**Overall: no active/live secret of any kind found in the tracked working tree or in a sampled history search.** Severity: N/A (no finding). This is a genuinely clean result, not merely an absence-of-evidence — the search was broad (multiple credential-pattern families) and the one ambiguous category (`sk_test_`/`pk_test_`/`whsec_` occurrences) was individually triaged file-by-file and confirmed non-live in every instance.

## 21. Configuration Matrix

| Integration / Variable | Required for Prod | Implemented | Prod Credential | Repo Verification | External Verification Required | Test/Sandbox Risk | Fail-Closed | Launch Impact |
|---|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | Yes | Yes | Absent (local placeholder only) | Yes | Provider dashboard (SSL mode, pooling) | Low — code enforces min length only | Yes (startup) | Blocker until real value + pooling confirmed |
| Stripe (4 required vars) | Yes | Yes (Connect, webhooks, disputes, payouts) | Absent | Yes | Stripe Dashboard (live keys, webhook endpoints) | Low — `sk_test_`/`pk_test_` hard-blocked in prod by code | Yes | Blocker until live keys + webhook endpoints configured |
| `RESEND_API_KEY`/`EMAIL_FROM` | Yes | Yes | Absent | Yes | Resend Dashboard (API key, domain SPF/DKIM) | Low | Yes | Blocker until real key + verified sending domain |
| Cloudinary (3 vars) | Yes | Yes (upload/delete); signed delivery **not implemented** | Absent | Yes | Cloudinary Dashboard + live sandbox test of signed-URL gap | Low for creds; Medium for the signed-URL functional gap | Yes (creds); N/A (signing) | Blocker for creds; verification-doc review UX plausibly broken regardless of creds (Module 103/106) |
| `AUTH_SECRET`/`AUTH_URL` | Yes | Yes | Absent/placeholder | Yes | None beyond generating+setting real values | Low — length/HTTPS enforced by code | Yes | Blocker until real 32+ char secret set |
| OAuth (Google/Apple/Facebook) | No (optional) | Yes | Absent | Yes | Each provider's developer console (redirect URIs) | Low | Soft (request-time only) | Non-blocking if OAuth sign-in not required at launch |
| `CRON_SECRET` | No (schema-optional; operationally required) | Yes (all 4 routes) | Absent | Yes | Vercel Dashboard | Low | Yes (503 if unset) | Blocker for scheduled jobs (reconciliation, GDPR purge, referral maintenance, workflow expiry) if left unset |
| `REDIS_URL` | Yes (production hard-required) | Yes (rate limiting; cache/lock/queue also use it) | Absent | Yes | Provision a managed Redis instance | Low | Yes (double-enforced) | Blocker — app will not start in production without it |
| `SENTRY_DSN` | Yes (production hard-required) | Yes | Absent | Yes | Sentry Dashboard | Low | Yes | Blocker — app will not start in production without it |
| Persona (3 vars) | Only if selected | Yes | Absent | Yes | Persona Dashboard, if activated | Low | Yes (once selected) | Non-blocking — manual verification is the default, fully functional fallback |
| Twilio / SMS | Only if selected | Yes | Absent | Yes | Twilio Console, if activated | Low | Yes (once selected) | Non-blocking — mock is default |
| Geocoding / Search providers | No | Yes (framework); real providers not wired with keys | Absent | Yes | N/A unless activated | Low | Fail-safe to STATIC/in-memory | Non-blocking |
| Fraud signal providers (FingerprintJS/IPQS) | No | Yes (framework) | Absent | Yes | N/A unless activated | Low | Fail-safe to null | Non-blocking |
| Vercel build/deploy settings, Node version, per-env var config | Implicit | N/A (platform config) | N/A | **No** — not expressible in repo | Vercel Dashboard | Unknown | N/A | Cannot be assessed from this repository |
| Database SSL / connection pooling for actual deploy target | Yes | Partial (standard Prisma pattern only) | N/A | Partial — architecture documented, target ambiguous | Vercel Dashboard / DB provider | Medium — depends on actual serverless-vs-long-running deploy target | N/A | Needs resolution before go-live if target is Vercel serverless |
| GitHub Actions CI | N/A (CI only) | Yes | N/A — placeholders only, by design | Yes | None | None | N/A | Non-blocking; CI is clean and isolated |


## 22. Findings

**Finding 1 — MEDIUM — Unsigned Cloudinary `private`-mode verification-document delivery (re-confirmed, not new).**
- Files: `src/core/infrastructure/storage/cloudinary/verification-document-upload-service.ts`, `src/core/infrastructure/storage/cloudinary/company-verification-document-upload-service.ts`.
- Explanation: documents are uploaded with `type: "private"` (correct), but no `private_download_url`/`utils.sign`/equivalent signing call exists anywhere in `src/core/**`, and the admin review page (per Module 103) renders the raw `secure_url` as a plain link.
- Production impact: the admin identity/business-document review feature is plausibly non-functional (a `type: "private"` asset refuses unsigned delivery for everyone) — not a security exposure, a likely functional gap.
- Code change required: Yes (implement signed-URL issuance behind an ownership/role-checked Server Action).
- External config required: No (pure code fix), though confirming the current behavior against a live Cloudinary sandbox is recommended first.
- Originally identified by: Module 103 (`MaestroYa_Module_103_IDOR_Authorization_Audit.md`, Finding 1 / roadmap item "Module 106").

**Finding 2 — MEDIUM — Database connection pooling strategy is unverified against the actual production deployment target.**
- Files: `src/core/infrastructure/database/prisma/client.ts`, `vercel.json`, `Dockerfile`, `docker-compose.prod.yml`.
- Explanation: the codebase's own documentation describes a long-running `next start`/Docker process model for which today's simple Prisma singleton pattern is sufficient, while `vercel.json`'s presence implies a Vercel deployment where serverless/Edge functions each get fresh connections per invocation — no PgBouncer/Prisma Accelerate/provider-pooler wiring exists for that scenario.
- Production impact: if the actual deploy target is Vercel serverless functions without a pooled `DATABASE_URL`, concurrent traffic could exhaust the managed Postgres connection limit under load.
- Code change required: Possibly (add pooling query-string params or Accelerate/Data Proxy) — contingent entirely on which deployment target is real.
- External config required: Yes — must first confirm the actual Vercel deployment mode and DB provider's pooling capability.

**Finding 3 — LOW — No PgBouncer/pooler convention documented for `DATABASE_URL`, and SSL mode is not enforced in code.**
- Files: `prisma/schema.prisma`, `env.ts`.
- Explanation: `DATABASE_URL` is validated only as a non-empty string; SSL (`sslmode=require`) and pooling parameters are entirely a property of the connection string operators must remember to set correctly.
- Production impact: a production `DATABASE_URL` configured without `sslmode=require` would transmit database credentials/traffic unencrypted over the network to a remote managed Postgres instance.
- Code change required: No (this is inherently connection-string configuration, not application logic) — optionally, a `superRefine` check could warn/require `sslmode` presence in production for defense-in-depth, but this would be a new code change, not something currently missing by omission of an existing safeguard.
- External config required: Yes — confirm the real production `DATABASE_URL` includes `sslmode=require` or the provider's TLS-enforcing equivalent.

**Finding 4 — LOW — `CRON_SECRET` is optional at the schema level with no production `superRefine` enforcement, unlike `SENTRY_DSN`/`REDIS_URL`.**
- Files: `env.ts` (no CRON_SECRET check in the `superRefine` block), all 4 cron `route.ts` files.
- Explanation: a production deployment can start successfully with `CRON_SECRET` unset; the only consequence is silent 503s on every cron invocation (correctly logged, but easy to miss without active log monitoring).
- Production impact: reconciliation, GDPR purge retries, workflow expiration, and referral/affiliate maintenance would silently never run.
- Code change required: Optional improvement — `env.ts` could add `CRON_SECRET` to its production `superRefine` block for symmetry with `SENTRY_DSN`/`REDIS_URL`'s "no silent gap" philosophy, though the current design (fail-closed per-request rather than fail-at-startup) is a legitimate, documented, defensible choice, not an oversight.
- External config required: Yes — `CRON_SECRET` must be set in Vercel's production environment.

**Finding 5 — LOW — OAuth provider misconfiguration fails at request time, not startup, unlike every other credentialed subsystem.**
- Files: `src/core/infrastructure/auth/auth-config.ts` (lines 124-135).
- Explanation: `Google`/`Apple`/`Facebook` providers are registered unconditionally with `env.AUTH_GOOGLE_ID` etc., which may be empty strings; `next-auth` does not validate this at construction time.
- Production impact: if a launch plan includes "Sign in with Google" but the credential was never set, users see a runtime sign-in failure rather than the deployment refusing to start — a softer failure mode than every other integration in this audit.
- Code change required: Optional — could add an `env.ts` production check requiring each OAuth pair to be all-or-nothing set, if OAuth is a hard launch requirement.
- External config required: Yes, if OAuth sign-in is intended for launch — each provider's developer console app + redirect URI.

**Finding 6 — LOW — Geocoding/Search provider misconfiguration is never a production hard-stop, even when a real (non-default) provider is selected without its key.**
- Files: `env.ts` (`GEOCODING_PROVIDER`/`SEARCH_PROVIDER` sections, lines 255-396 — no corresponding entries in the `superRefine` production block, unlike SMS/Persona/FingerprintJS/IPQS/OTLP/Read-Replicas which all have this exact "validly selected but missing credential" check).
- Explanation: unlike every other swappable-provider selector in this schema, selecting `GEOCODING_PROVIDER=MAPBOX` (etc.) or `SEARCH_PROVIDER=meilisearch` without the matching key/host silently degrades to `STATIC`/in-memory even in production, rather than failing startup — an inconsistency with the schema's own otherwise-uniform "deliberately and validly selected must not silently run half-configured" rule.
- Production impact: low — the degrade target is always a safe, functional (if less capable) default, never a broken state; this is arguably the intentional, correct choice for these two specifically non-critical subsystems, but it is inconsistent with the pattern applied everywhere else in the same file and worth an explicit product decision either way.
- Code change required: Optional — add the same conditional `superRefine` check applied to SMS/Persona/fraud providers, if geocoding/search accuracy is considered launch-critical.
- External config required: No.

**Finding 7 — INFORMATIONAL — No live-service/dashboard verification was possible from this audit for any external provider.**
- Explanation: this audit had no credentials and made no network calls, per its explicit read-only mandate. Every classification of "REQUIRES [X] DASHBOARD VERIFICATION" throughout this report represents work that must be done outside this repository before launch — it is not evidence of a defect.
- Production impact: N/A — informational.
- Code change required: No.
- External config required: Yes, comprehensively (see §23).

## 23. Launch Blockers

### Technical
- None found. No code defect in this audit rises to a hard launch-blocking severity on its own — the two MEDIUM findings (Cloudinary signed-URL gap, DB pooling-strategy ambiguity) are real but each has a bounded, well-understood remediation path and neither represents broken core payment/auth/data-integrity logic.

### Configuration (must be completed before go-live; none require a code change)
1. Provision and set real production credentials for: Stripe (live keys + both webhook endpoints registered), Resend (API key + verified `maestroya.es` sending domain), Cloudinary (account credentials), `AUTH_SECRET` (real, ≥32-char, generated value), `AUTH_URL`/`NEXT_PUBLIC_APP_URL` (real HTTPS production domain), `DATABASE_URL` (real managed Postgres, with SSL and, contingent on Finding 2, pooling).
2. Provision a production Redis instance and set `REDIS_URL` — **the application will refuse to start in `NODE_ENV=production` without this,** confirmed by direct code reading of a double-enforced guard.
3. Provision Sentry and set `SENTRY_DSN` — **the application will refuse to start in `NODE_ENV=production` without this.**
4. Set `CRON_SECRET` in Vercel's production environment variables — without it, all four scheduled jobs (financial reconciliation, GDPR erasure completion, workflow expiration, referral/affiliate maintenance) silently never execute.
5. Resolve the deployment-target ambiguity (Vercel serverless vs. the Dockerized long-running process this codebase also fully supports) and confirm/add connection pooling accordingly (Finding 2).
6. If OAuth sign-in (Google/Apple/Facebook) is part of the launch scope, register each provider's app and set its credentials — otherwise these can be safely left unset for a launch scoped to email/password only.
7. Confirm Cloudinary's signed-delivery gap (Finding 1) against a live sandbox and, if broken as this audit's static analysis suggests, implement the fix Module 103 already scoped ("Module 106" in that report).

### Operational
- Confirm log/alert monitoring exists for the 503 cron-auth-missing log line (Finding 4) and for Sentry's own alerting once configured, so a missing `CRON_SECRET` or `SENTRY_DSN` misconfiguration is caught quickly rather than silently.
- Confirm a real production database migration runbook exists (this repository deliberately does not automate `prisma migrate deploy` against production — by design, per the Dockerfile's own reasoning — but that means an explicit, tested runbook must exist outside this repository).
- Confirm Vercel Cron is actually enabled/available on the project's plan tier (a platform/billing consideration outside this repository's visibility).

### Legal/Business (referenced only, not resolved or reinterpreted by this module)
- A materials/commission tax-formula disagreement (H5, `MaestroYa_Production_Readiness_Audit_2026-08-29.md`) was flagged in an earlier audit; this module did not re-verify its current resolution status, which is outside this module's environment/API scope — see §4.
- The `legal/` folder's contents (a legal consultation RFP, law-firm cost comparisons, and cost briefs for three named legal advisors) indicate an unresolved, apparently not-yet-engaged legal consultation process. This audit does not open, interpret, or resolve any of that material — it is referenced here purely as external, non-code context that a genuinely complete go-live decision should account for.

## 24. Score

**Total: 78 / 100**

| Category | Weight | Score | Rationale |
|---|---|---|---|
| Environment variable correctness | 15 | 14 | Single, comprehensive, exhaustively-documented Zod validation boundary; every variable typed, bounded, and defaulted correctly; one minor inconsistency (Finding 6 — geocoding/search selectors not covered by the otherwise-uniform production `superRefine` pattern) costs 1 point. |
| External API integration readiness | 20 | 15 | Stripe/Resend/Cloudinary/Persona are all genuinely implemented with correct webhook verification, idempotency, and fail-closed behavior; costs: the unresolved Cloudinary signed-URL gap (Finding 1, a real functional risk, not just missing credentials), and the fact that literally zero production credentials exist for any paid service (expected pre-launch state, but it does mean zero of these integrations have been exercised end-to-end against a live counterpart). |
| Production/test separation | 10 | 10 | No defect found: code-enforced Stripe test-key rejection in production, code-enforced test-database hostname/name guards, CI uses only placeholders with zero real secrets referenced, Docker build-stage placeholders clearly separated from runtime secrets. |
| Security/secrets configuration | 15 | 14 | Zero committed live secrets (verified via broad pattern scan and a sampled full-history search); timing-safe comparisons for both cron and Persona webhook auth; AUTH_SECRET length + HTTPS enforcement in production; double-enforced Redis-in-production guarantee. One point held back for the Cloudinary document-delivery gap's latent risk profile (not itself an IDOR, but adjacent to sensitive-document handling) and the softer OAuth failure mode (Finding 5). |
| Deployment/Vercel readiness | 10 | 6 | `vercel.json` is correct and minimal for what it covers (cron), but the deployment-target ambiguity (Vercel serverless vs. long-running Docker — Finding 2) is a real open question this audit could not resolve, and essentially all Vercel-dashboard-side configuration (env vars, Node version, build settings) is unverifiable from this repository by definition. |
| Cron/background processing | 10 | 9 | All four cron routes are correctly implemented with timing-safe, fail-closed authorization and sensible cadences; the only gap is `CRON_SECRET` not being a hard production-startup requirement (Finding 4), a defensible design choice rather than a clear defect. |
| Database/Prisma production configuration | 10 | 6 | Migration-deploy discipline (explicit, non-automatic, documented) is genuinely good; connection pooling/SSL enforcement is the least-verified area of this entire audit (Findings 2 and 3) and is squarely dependent on external configuration this repository cannot express or confirm. |
| Observability/operational readiness | 5 | 4 | Sentry required in production with correct client/server DSN separation; health-check/circuit-breaker framework present; structured logging throughout; distributed tracing available opt-in. Minor deduction: no external verification of Sentry project/alerting configuration was possible. |
| Documentation/configuration clarity | 5 | 5 | Genuinely exceptional — `.env.example` and `env.ts` together constitute some of the most thorough, self-explaining environment documentation this kind of audit typically encounters; every variable's purpose, default, and failure mode is explained inline, materially easing this very audit. |

## 25. Final Verdict

**READY WITH MEDIUM-LOW CONFIGURATION FINDINGS**

No code-level defect found in this audit rises to a launch-blocking severity, and the absence of real production credentials for paid third-party services is expected, unavoidable pre-launch repository state — correctly classified A/B throughout this report rather than treated as a NOT READY driver, per this module's own instructions. The codebase's fail-closed discipline for every genuine trust boundary (payments, auth, cron authorization, rate-limiting infrastructure, webhook signature verification) is real, consistently applied, and independently verified by direct code reading rather than taken on faith from doc comments. The path to launch consists overwhelmingly of external configuration work (provisioning Redis/Sentry/Stripe-live/Resend/Cloudinary/a production database with correct SSL+pooling, and setting the resulting credentials in Vercel) plus one concretely-scoped code fix (Cloudinary signed-URL delivery, already identified and roadmapped by Module 103) and one architecture decision that needs making explicit (actual deployment target, for connection-pooling purposes). None of this is BLOCKED BY EXTERNAL CONFIGURATION VERIFICATION in the sense of "this audit cannot proceed without it" — every code-level claim in this report was independently verifiable from the repository alone; it is READY WITH MEDIUM-LOW CONFIGURATION FINDINGS in the sense that a real go-live still requires completing that external configuration work, which is normal and expected at this stage, not a sign the engineering is unfinished.

## 26. Recommended Next Steps

1. **Provision production infrastructure and credentials** for Redis, Sentry, Stripe (live mode + both webhook endpoints), Resend (+ verified sending domain), Cloudinary, and a production Postgres instance with `sslmode=require` — the first three of these are hard application-startup requirements in `NODE_ENV=production`, confirmed by direct code reading.
2. **Resolve the deployment-target question** (Vercel serverless functions vs. the Dockerized long-running process this codebase equally supports) and, if serverless, add a connection-pooling layer to `DATABASE_URL` (PgBouncer, Prisma Accelerate, or the DB provider's native pooler) before go-live (Finding 2).
3. **Confirm the Cloudinary signed-URL gap against a live sandbox** and implement the fix already scoped by Module 103 ("Module 106" in that report) if confirmed broken — a bounded, well-understood code change (Finding 1).
4. **Set `CRON_SECRET` in the Vercel production environment** and confirm each of the four scheduled jobs actually fires post-deploy (check logs for the "CRON_SECRET is not configured" 503 line, which would indicate it was missed).
5. **Decide OAuth launch scope** — if Google/Apple/Facebook sign-in is required at launch, register each provider's app now; if not, explicitly defer and document that email/password is the only supported method at launch.
6. **Run this same audit's environment/API-readiness checks again in a CI-equivalent environment** (per Module 104's own recommendation) to independently confirm `next build`, the real-Postgres integration suite, and E2E all still pass at the current HEAD — this sandboxed audit environment could not execute any of those, consistent with Module 104's own documented limitation.
7. **Advance the pending legal consultation** referenced by the `legal/` folder's contents, and re-confirm the current resolution status of the materials/commission tax-formula disagreement (H5) — both outside this module's scope to resolve, but both belong on the same go-live checklist as the technical items above.

---

*End of Module 105 report.*
