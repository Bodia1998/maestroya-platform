# Module 25 — Production Infrastructure

## 1. Objective

Build the production infrastructure foundation required to safely deploy
and operate MaestroYa in production: validated environment configuration,
structured logging, request correlation, production-safe error handling,
liveness/readiness health checks, database production practices, HTTP
security headers, cookie/session hardening, distributed-deployment
readiness for Module 24's rate limiter, Docker/CI readiness, graceful
shutdown, and documentation. Explicitly excludes Stripe Connect business
logic (Module 12) and IVA/tax logic (Module 26) — see §27–28.

## 2. Audit findings

The codebase already had a meaningfully mature starting point, which
shaped what this module added vs. reused:

| Area | Found at audit time |
|---|---|
| Env validation | `infrastructure/config/env.ts` already existed — zod-validated, fail-fast, but no prod-specific hardening, no client/server runtime guard, no observability/rate-limit vars |
| Health check | `src/app/api/health/route.ts` already existed — combined liveness+DB readiness in one endpoint |
| Logging | Ad hoc `console.log`/`console.error` (~100 call sites), no structure, no levels, no redaction |
| Request correlation | None |
| Error handling | Domain layer already has a clean `DomainError` hierarchy (`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ConflictError`, `RateLimitedError`, `AccountRestrictedError`); Server Actions already translate these to safe `{ error }` shapes per-use-case. No equivalent for Route Handlers |
| Rate limiting | Module 24's `RateLimitRepository` interface + `InMemoryRateLimitRepository`, explicitly documented as "deferred to Module 25" for a distributed backend |
| Prisma client | Already a correct `globalThis`-cached singleton with dev/prod log-level split |
| Security headers | `next.config.ts` already set `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. No CSP, no HSTS |
| Auth/session | Auth.js v5, JWT strategy, `PrismaAdapter` for OAuth linking. No `trustHost` — would fail with `UntrustedHost` on any non-Vercel host |
| CI | `.github/workflows/ci.yml` already ran install/lint/typecheck/migrate/test/build against a real Postgres service container |
| Docker | `docker-compose.yml` — Postgres only, dev convenience. No production Dockerfile |
| Email | `ConsoleEmailSender` — intentional placeholder (module 02's own scope note), logs instead of sending |
| Distributed state audit | Only two process-local structures in the whole codebase: the Prisma client singleton (correct, intentional) and `InMemoryRateLimitRepository` (documented limitation) |

## 3. Existing infrastructure reused (not duplicated)

- `env.ts`'s zod schema and fail-fast pattern — extended, not replaced.
- `domain/errors/domain-error.ts`'s `DomainError` hierarchy — the new
  Route Handler error mapper (§9) dispatches on it rather than
  reinventing error types.
- `infrastructure/database/prisma/client.ts`'s singleton pattern — left
  as-is (already correct); only consumed by the new graceful-shutdown
  hook.
- Module 24's `RateLimitRepository` interface and
  `InMemoryRateLimitRepository` — left as-is; this module documents the
  production requirement rather than swapping the implementation (see
  §14).
- `src/app/api/health/route.ts` — improved in place rather than
  duplicated (split into liveness/readiness, see §10).
- The existing CI pipeline — extended with two additional steps, not
  replaced.

## 4. New infrastructure implemented

| File | Purpose |
|---|---|
| `src/core/infrastructure/config/env.ts` (modified) | Client/server boundary guard, `LOG_LEVEL`, `AUTH_TRUST_HOST`, `REDIS_URL`, production-only hardening via `superRefine`, `isProduction`/`isDevelopment`/`isTest` |
| `src/core/infrastructure/observability/logger.ts` | Structured JSON logger with level filtering and key-based redaction |
| `src/core/infrastructure/observability/request-id.ts` | Request ID generation/validation (framework-agnostic) |
| `src/core/infrastructure/observability/server-request-context.ts` | Reads the resolved request ID from `next/headers` inside Server Components/Actions |
| `src/core/infrastructure/observability/http-error-response.ts` | Production-safe `DomainError`/unexpected-error → HTTP response mapping for Route Handlers |
| `src/app/api/health/route.ts` (modified) | Liveness only — no dependencies |
| `src/app/api/health/ready/route.ts` | Readiness — checks PostgreSQL via Prisma |
| `middleware.ts` (modified) | Resolves/propagates `X-Request-ID` for every middleware-matched request |
| `next.config.ts` (modified) | CSP, HSTS (prod-only), `output: "standalone"` |
| `src/core/infrastructure/auth/auth-config.ts` (modified) | `trustHost` wired to `AUTH_TRUST_HOST` |
| `instrumentation.ts` | Startup log + Prisma graceful shutdown on SIGTERM/SIGINT |
| `Dockerfile`, `.dockerignore` | Production multi-stage build, non-root, healthcheck |
| `docker-compose.prod.yml` | Reference production topology |
| `.github/workflows/ci.yml` (modified) | Added `prisma validate` and `prisma migrate status` steps |
| `.env.example` (modified) | Documents new variables |
| `package.json` (modified) | Added `server-only` dependency (§5a) |
| `vitest.config.ts` (modified) | Aliases `server-only` to a no-op test stub (§5a) |
| `tests/test-utils/server-only-stub.ts` | No-op stub used by the above alias |
| Tests (§24) | Env, logger, request-id, error-mapping, health routes, security headers |

## 5. Environment variables

New/changed variables (all optional/defaulted unless noted):

| Variable | Required | Notes |
|---|---|---|
| `LOG_LEVEL` | No (`info`) | `debug`\|`info`\|`warn`\|`error` |
| `AUTH_TRUST_HOST` | No (`true`) | Set `false` only if a strict Host-validating proxy already sits in front of the app |
| `REDIS_URL` | No | Not consumed by any code yet — reserved for a future distributed rate-limit backend (§14) |

Production-only hardening (rejected at startup, not just a warning):

- `AUTH_SECRET` must be ≥32 characters.
- `NEXT_PUBLIC_APP_URL` and `AUTH_URL` must be `https://`.
- `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` must not be test-mode
  (`sk_test_`/`pk_test_`) keys.
- These checks are skipped specifically during `next build`
  (`NEXT_PHASE=phase-production-build`, set internally by Next.js, not by
  this codebase) because `next build` itself forces `NODE_ENV=production`
  even for a CI build running on placeholder secrets. Real `next
  start`/production runtime is unaffected and still validates strictly.

Client/server separation: `env.ts` (and the other genuinely server-only
modules listed in §5a) imports the `server-only` package rather than a
runtime `typeof window !== "undefined"` check — see §5a for why the
`typeof window` approach was tried, reverted, and replaced.

### 5a. Post-launch fix: `server-only` instead of a `typeof window` runtime guard

The first version of this module's `env.ts` enforced the client/server
boundary with:

```ts
if (typeof window !== "undefined") {
  throw new Error(/* ... */);
}
```

This caused a real regression: Vitest's `jsdom` test environment defines
a global `window` for **every** test file, regardless of whether the
code under test is client-only or server-only. Any test that imported
`env.ts` — directly, or transitively through `logger.ts`,
`http-error-response.ts`, DTOs, or anything else touching config — hit
this guard and failed, even though importing server-only code from a
server-side test is the correct, intended way to test it.
`typeof window` cannot distinguish "actually running in a browser" from
"running in a test runner that happens to define a `window` global for
unrelated reasons (React Testing Library, DOM assertions, etc.)".

**Fix — enforce the boundary at the framework/bundler level instead:**

- `env.ts` and every other genuinely server-only module (`logger.ts`,
  `http-error-response.ts`, `server-request-context.ts`, `auth-config.ts`,
  `request-context.ts`, `stripe/client.ts`, `cloudinary/client.ts`) now
  starts with `import "server-only";`.
- `server-only` is the same marker package the wider Next.js ecosystem
  and Next's own docs recommend for exactly this purpose. Its
  `package.json` uses a conditional `exports` map keyed on the
  `react-server` resolve condition: Next.js's webpack build sets that
  condition for the server module graph (Server Components, Route
  Handlers, Server Actions, middleware), where the package resolves to a
  no-op file — but resolves to a throwing implementation for any module
  reachable from the **client** bundle, where that condition is absent.
  That's the actual boundary this needs to guard, enforced by the
  bundler rather than a runtime global check.
- Outside of Next's own bundler — including plain Node.js module
  resolution, which is what Vitest uses — neither the `react-server`
  condition nor any other special condition is active, so `server-only`
  falls back to its throwing `default` export unconditionally (verified
  directly: `node -e "require('server-only')"` throws in this sandbox
  even with no `window` involved at all). `vitest.config.ts` therefore
  aliases the bare specifier `server-only` to a new, explicit no-op stub
  — `tests/test-utils/server-only-stub.ts` — so a server-side test
  importing server-only code is treated as the legitimate use case it
  is, rather than silently working around the guard or weakening it.
- Added the `server-only` package to `package.json` dependencies
  (`^0.0.1`, the official package from the React/Next.js team). This
  sandbox has no network access to the npm registry (confirmed
  independently in §25 for three other toolchains, and again here — a
  direct `npm install server-only` and even a plain `npm view` on an
  unrelated public package both returned `403 Forbidden` through this
  environment's egress proxy), so the package was vendored locally under
  `node_modules/server-only` for this sandbox's own use, copied
  byte-for-byte from `node_modules/next/dist/compiled/server-only` (Next
  already bundles this exact package internally for its own use). A real
  `npm install` on a machine with registry access will fetch the
  published package and additionally regenerate `package-lock.json`.
- **Pre-existing, unrelated lockfile drift discovered while doing this:**
  `package-lock.json` was already out of sync with `package.json` before
  this fix — `bcryptjs` and `@types/bcryptjs` are both declared in
  `package.json` and physically present in `node_modules`, but neither
  has an entry in `package-lock.json`. This means `npm ci` (used by CI)
  was already at risk of failing on a truly clean checkout even before
  Module 25. Not introduced by this change; flagged here because it
  surfaces from the same investigation. `package-lock.json` was
  deliberately **not** hand-edited to add `server-only` or fix this drift
  — doing so without running the real `npm install`/`npm ci` resolver
  risks producing an internally inconsistent lockfile, which is worse
  than an honestly-flagged one. Run `npm install` once on a machine with
  registry access to regenerate it correctly.

## 6. Production configuration (`next.config.ts`)

- `output: "standalone"` — required for the production Dockerfile (§20).
- Content-Security-Policy scoped to this app's actual dependencies
  (`self`, `res.cloudinary.com` for images, `api.stripe.com` for
  `connect-src`). Uses `'unsafe-inline'` for `script-src`/`style-src`
  rather than nonces — see §26 for why, and the future-improvement note.
- `Strict-Transport-Security` added only when `NODE_ENV=production` (HSTS
  over plain HTTP in dev would have browsers remember a bad instruction
  for `localhost`).
- Pre-existing headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`) unchanged.

## 7. Logging

`infrastructure/observability/logger.ts` — one JSON object per line:
`timestamp`, `level`, `event`, optional `requestId`, arbitrary metadata.
Redacts any object key matching
`/password|passwd|secret|token|apikey|api_key|authorization|cookie|session|refresh|credential|ssn|creditcard|card_?number|cvv/i`
recursively, including nested objects, before serializing. `Error`
instances are serialized to `{ name, message, stack }` (stack traces stay
server-side only — never returned to a client, see §9).

Existing `console.log`/`console.error` call sites across ~30 use-case
files were **not** bulk-replaced — that's a large, cross-module,
non-additive change out of scope for this module (see §26).new
production-infrastructure code (health checks, error handling) uses the
new logger; other modules can adopt it incrementally.

## 8. Request correlation

`X-Request-ID` header, generated with `crypto.randomUUID()`.
`resolveRequestId()` reuses an incoming header value only if it matches
the v4-UUID shape; anything else (missing, malformed, or a client
attempting to inject arbitrary content into the correlation field) is
discarded and replaced. `middleware.ts` resolves the ID once and injects
it onto both the outgoing request headers (so anything downstream can
read it via `next/headers`, see `server-request-context.ts`) and the
response headers.

Known scope limit: `middleware.ts`'s matcher excludes `/api/**` and
static assets (pre-existing, documented in that file — running
middleware on every asset request adds latency). Route Handlers under
`/api/**` therefore resolve their own request ID directly rather than
relying on middleware; both health endpoints do this.

## 9. Error handling

`http-error-response.ts` is the Route Handler equivalent of the pattern
already used by every Server Action: a known `DomainError` is safe to
return verbatim (status mapped from its `code`); anything else is logged
server-side in full (message, stack, request ID) and reduced to a
generic `{ error, code: "INTERNAL_ERROR", requestId }` in production. In
non-production, the real message is still returned to speed up local
debugging.

This module does **not** rewrite the many existing Server Actions to use
this new utility — they already have their own, working, per-use-case
`DomainError` handling; retrofitting ~40 use-cases to a new shared
utility is an unrelated-modules risk this task explicitly warns against.

## 10. Health / readiness

Split into two endpoints (previously one endpoint did both jobs):

- `GET /api/health` — **liveness**. No dependencies. Answers "is the
  process alive". Point a container orchestrator's liveness probe here.
- `GET /api/health/ready` — **readiness**. Checks PostgreSQL via
  `prisma.$queryRaw`SELECT 1``. Returns `503` (not `500`) on failure.
  Point a load balancer/orchestrator readiness probe here.

Deliberately does not gate readiness on Cloudinary, Stripe, or email —
those are optional/degradable dependencies; see the route's own comment
for the full reasoning (§ "Health checks" of the task, and the file
itself).

## 11. Database production practices

- Prisma client remains a `globalThis`-cached singleton (already
  correct) — no per-request `new PrismaClient()`.
- `instrumentation.ts` closes the connection pool on SIGTERM/SIGINT.
- Migrations: `npm run prisma:migrate:deploy` (`prisma migrate deploy`)
  is the only sanctioned production migration path — never `prisma db
  push`. The production Dockerfile does **not** run migrations from its
  entrypoint (see its own comment: multiple replicas starting
  concurrently must never race to apply the same migration); CI already
  runs `prisma migrate deploy` as an explicit step, and that's the
  pattern a real deploy should follow (a dedicated, single-runner
  migration step before rolling out new app instances).
- No schema changes were required for this module, so no new migration
  was created.

## 12. Security headers

See §6. Summary: `X-DNS-Prefetch-Control`, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
(pre-existing) + `Content-Security-Policy` and conditional
`Strict-Transport-Security` (new).

## 13. Cookie/session security

Auth.js v5 already sets secure, `HttpOnly`, appropriately-`SameSite`
cookies automatically based on the request protocol (the
`__Secure-`-prefixed cookie names activate automatically once served
over HTTPS). The one real gap found: no `trustHost`, which would cause
every request to fail with `UntrustedHost` on any self-hosted deployment
(Docker, a VM behind nginx/any reverse proxy — anything that isn't
Vercel's own platform integration). Fixed via `trustHost:
env.AUTH_TRUST_HOST` (default `true`, overridable). Session strategy
(`jwt`), `maxAge` handling, and the "remember me" mechanism were audited
and left unchanged — they're already correct and are Authentication
Module (02)'s domain, not Module 25's.

## 14. Module 24 integration

Module 24's `RateLimitRepository` interface and
`InMemoryRateLimitRepository` were already explicitly designed for this
moment (see that file's own doc comment and
`docs/MODULE_24_SECURITY_ANTI_ABUSE.md`, "Deferred to Module 25"). This
module:

- Confirmed the interface requires no changes to support a distributed
  backend — a future `RedisRateLimitRepository` is a drop-in swap at
  `application/use-cases/security/compose.ts`, zero caller changes.
- Added `REDIS_URL` to `env.ts` (validated shape only, optional, not
  consumed by any code) so that future implementation has a ready,
  validated place to read its connection string from.
- Did **not** add an actual Redis client/dependency. No `REDIS_URL` is
  configured in any environment today, and this codebase has zero
  existing Redis usage — introducing the dependency now would be
  speculative infrastructure with no way to test it against a real
  environment in this task, and directly contradicts the explicit
  instruction not to introduce a hard Redis dependency unless required.
  **This is the single largest deliberately-deferred item** — see §29.
- `AccountRestriction` (the other half of Module 24's distributed-state
  story) is already Prisma-backed, not in-memory, so no change was
  needed there for multi-instance correctness.

## 15. Distributed deployment considerations

Full-codebase audit for process-local state found exactly two
structures, both already known and documented:

1. `InMemoryRateLimitRepository`'s `Map` (Module 24, see §14).
2. The Prisma client `globalThis` cache — this is *correct*, intentional
   per-instance state (a connection pool), not a correctness bug.

No other in-memory caches, local filesystem persistence, or
process-pinned background tasks were found. The app has no
serverless-specific complications beyond the standard Prisma connection
pooling guidance (already handled by the singleton pattern) since it's
deployed as a long-running `next start` process, not a
per-invocation serverless function.

## 16. File storage

Cloudinary is the only file storage in the codebase (portfolio images,
verification documents, per `infrastructure/storage/cloudinary/client.ts`).
Already production-appropriate: no local-filesystem persistence path
exists to migrate away from. `env.ts` already required
`CLOUDINARY_API_SECRET` etc.; this module added no changes here beyond
the general client/server boundary guard (§5) that already covered it.

## 17. Email/notifications

`ConsoleEmailSender` (Authentication module) logs emails instead of
sending them — an intentional, explicitly-scoped placeholder, not a bug.
No production email provider is wired up. Out of scope to build one here
(would be inventing a vendor dependency with no environment variables or
requirement driving the choice); documented as a manual production setup
item (§30).

## 18. Background jobs

None exist in the codebase (no cron, no queue, no scheduled task
runner). Notification/email side effects are synchronous, best-effort,
swallow-and-log operations inline in use-cases (e.g.
`notify-appointment-party.ts`) — safe as-is for the current scale;
flagged as a future improvement (§29) rather than built now, per the
explicit instruction not to introduce a job queue without a genuine
current requirement.

## 19. Graceful shutdown

`instrumentation.ts`'s `register()` hook (Node.js runtime only) closes
the Prisma connection pool on `SIGTERM`/`SIGINT`. Next.js's own HTTP
server lifecycle is left untouched — it already manages in-flight
request draining correctly; this only adds the one resource Next.js
doesn't know about (the app's database connection pool).

## 20. CI/CD

`.github/workflows/ci.yml` already ran install → lint → typecheck →
migrate → test → build against a real Postgres service container — a
solid baseline. Added two steps: `prisma validate` (schema-only
sanity check, fast fail before spinning up migrations) and `prisma
migrate status` (confirms the deployed schema matches migration history,
catching drift). No deployment step was added — no deployment
infrastructure/target exists in this repository to deploy to.

## 21. Docker/container configuration

`docker-compose.yml` (dev Postgres) is unchanged. Added:

- `Dockerfile` — multi-stage (`deps` → `builder` → `runner`), uses
  `output: "standalone"`, runs as a non-root `nextjs` user, includes a
  `HEALTHCHECK` against the liveness endpoint (not readiness — a
  transient DB blip shouldn't make Docker restart a healthy container).
  Deliberately does not run `prisma migrate deploy` in the entrypoint —
  see §11.
- `.dockerignore` — excludes `node_modules`, `.next`, test artifacts,
  `.env*`, git metadata.
- `docker-compose.prod.yml` — a runnable reference production topology
  (Postgres + containerized app), for staging/self-hosted use; a real
  deployment would typically point at a managed Postgres instead.

## 22. Observability boundaries

`logger.ts` is a plain, dependency-free abstraction (stdout JSON lines)
— ready for a log aggregator to pick up without any vendor coupling. No
error-tracking (Sentry) or tracing (OpenTelemetry) SDK was added: none
was configured anywhere in the existing codebase, and introducing one
now would be a speculative vendor dependency with no environment
variables or team decision behind it. The logging/error-mapping seams
(`logger.ts`, `http-error-response.ts`) are exactly where such an SDK
would be wired in later without touching call sites.

## 23. Security considerations

- No secrets are logged (redaction, §7) or returned to clients in
  production error responses (§9).
- No stack traces, Prisma internals, or file paths reach a production
  client.
- Request IDs from untrusted clients are validated before reuse (§8) —
  cannot be used to inject arbitrary content into structured logs.
- `env.ts`'s client-import guard prevents secrets from silently reaching
  a browser bundle.
- Production-only checks reject weak `AUTH_SECRET`, non-HTTPS URLs, and
  test-mode Stripe keys at startup rather than allowing a misconfigured
  production deploy to boot.
- `trustHost` addition is scoped via an explicit env var, not
  unconditionally enabled with no override.

## 24. Testing

Added (all under `tests/unit/core/infrastructure/**` and
`tests/integration/observability/**`, following the existing
fakes/describe-it conventions):

- `config/env.test.ts` + `config/env-fixture.ts` — valid config parsing,
  missing/malformed variables, production hardening (weak secret,
  non-HTTPS, test-mode Stripe keys), the `NEXT_PHASE` build-time bypass,
  `AUTH_TRUST_HOST` coercion.
- `observability/logger.test.ts` — structured JSON shape, level routing
  (console.log vs console.error), redaction (top-level and nested),
  LOG_LEVEL threshold filtering, Error serialization.
- `observability/request-id.test.ts` — UUID generation/validation,
  trusted-reuse vs untrusted-discard behavior.
- `observability/http-error-response.test.ts` — DomainError → status/code
  mapping, production message redaction, non-production passthrough.
- `tests/integration/observability/health-routes.test.ts` — liveness
  never touches the DB even when it's mocked to fail; readiness returns
  200/503 correctly; request ID propagation/reuse on both routes.
- `tests/unit/next.config.test.ts` — security headers and CSP directives
  present, `output: "standalone"` set.

No existing test was modified or weakened.

## 25. Validation results

Commands run against this sandbox:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **Pass** — zero errors (both before and after the §5a fix) |
| `npx eslint .` | **Pass** — zero errors, zero warnings (both before and after the §5a fix) |
| `npx prisma validate` | **Blocked** — environmental (see below) |
| `npx prisma migrate status` | Not run — same blocker |
| `npm test` (vitest) | **Blocked** — environmental (see below); root-caused and fixed at the code level regardless (§5a) |
| `npm run build` (next build) | **Blocked** — environmental (see below) |

**Environmental limitation, not a code defect:** this sandbox's
`node_modules` contains native binaries for the wrong platform for this
runner (Ubuntu 22.04, `aarch64`/linux-arm64-gnu) — confirmed
independently for four separate toolchains: Rollup
(`@rollup/rollup-linux-arm64-gnu` missing, only `-darwin-arm64` present —
Vitest is built on Vite/Rollup), esbuild (`@esbuild/linux-arm64` missing,
only `@esbuild/darwin-arm64` present — confirmed by directly running
`npx tsx` against a throwaway script, which failed with esbuild's own
"installed for another platform" error), Next's SWC compiler
(`@next/swc-linux-arm64-gnu`/`-musl` missing), and Prisma's engines (a
file literally named `schema-engine-linux-arm64-openssl-3.0.x` is
actually a macOS Mach-O binary, not a Linux ELF one). The sandbox also
has no route to the npm registry to fetch replacements: `npm install`,
`npm view`, and a direct `curl` through the sandbox's own configured
egress proxy against `registry.npmjs.org` all returned `403 Forbidden` —
including for unrelated, well-known public packages, confirming this is
a network policy, not a per-package issue. `tsc` and `eslint` have no
native-binary dependency, which is exactly why they're the two commands
that ran successfully end-to-end, both before this fix and after. This
reflects the sandbox's package installation history (`node_modules` was
populated on a macOS/darwin-arm64 machine, not this Linux runner), not
anything introduced by Module 25's changes — the same commands should
run cleanly in the project's actual CI (which installs its own
`node_modules` fresh via `npm ci` on a matched Linux runner) or on a
correctly-provisioned local machine.

**Given `npm test` could not execute here, the regression fix (§5a) was
instead verified by direct reasoning plus two targeted experiments run
with plain `node -e`, which has no native-binary dependency:**

1. `node -e "require('server-only')"` — confirmed the real package
   throws unconditionally under plain Node module resolution (no
   `window`, no browser, nothing "client" about it) — this proves *why*
   a bare `import "server-only"` would still break tests without the
   `vitest.config.ts` alias, and why the alias (not just adding the
   import) is the actual fix, not an incidental extra.
2. The same check repeated after temporarily swapping
   `node_modules/server-only`'s contents for the exact stub used in
   `vitest.config.ts`'s alias confirmed it becomes a silent no-op — i.e.
   the alias mechanism itself is sound — before the real package
   contents were restored.

This is a substitute for actually running the suite, not a replacement
for it — **the full `npm test` run in a working environment (real CI or
a correctly-provisioned machine) is the outstanding confirmation step**
and should be done before declaring this fix verified end-to-end. Given
the regression was precisely and reproducibly root-caused (a `jsdom`
global colliding with a `typeof window` check — not a flaky or unclear
failure) and the fix follows the standard, documented `server-only`
pattern exactly, there is high confidence it resolves all 23 failures
without new ones, but this module does not claim that confirmed until
that run happens.

## 26. Known limitations

- CSP uses `'unsafe-inline'` for `script-src`/`style-src` rather than a
  nonce-based policy — see §6 and §29.
- Existing `console.log`/`console.error` call sites across use-cases were
  not migrated to the new structured logger (deliberately, to avoid an
  unrelated-modules-wide change).
- Existing Server Actions were not retrofitted to use the new
  `http-error-response.ts` (deliberately, same reasoning).
- No distributed rate-limit backend was implemented (§14, §29).
- No error-tracking/tracing SDK integrated (§22).
- Validation commands requiring native binaries could not be executed in
  this sandbox (§25) — **`npm test` must still be run in a working
  environment to confirm the §5a regression fix end-to-end**, and
  `npm run build`/`prisma validate`/`prisma migrate status` likewise need
  confirmation there.
- `package-lock.json` has pre-existing drift from `package.json`
  (missing `bcryptjs`/`@types/bcryptjs` entries, discovered during §5a)
  and now also needs `npm install` run once to add `server-only` —
  neither was hand-edited into the lockfile (§5a explains why).

## 27. Explicit boundary with Module 12 (Payment/Stripe Connect)

Module 25 validates that Stripe environment variables are present and
well-formed (already required by `env.ts` before this module), and adds
a production check rejecting test-mode keys. It does **not** implement
any Stripe Connect onboarding, payment intents, transfers, payouts,
refunds, webhook processing, or settlement logic — none of that exists
in this codebase yet, and none was added.

## 28. Explicit boundary with Module 26 (IVA/Tax)

Module 25 touches no tax/IVA logic, tax rates, invoicing, or reporting.
No such logic exists in the codebase, and none was added.

## 29. Production deployment checklist

- [ ] Set every required env var (see `.env.example`) with real
      production values; confirm `AUTH_SECRET` is ≥32 random characters
      (`npx auth secret`), `NEXT_PUBLIC_APP_URL`/`AUTH_URL` are `https://`
      and match the real domain, and Stripe keys are live-mode.
- [ ] Set `AUTH_TRUST_HOST=false` only if a Host-validating proxy already
      sits in front of the app; otherwise leave the default (`true`).
- [ ] Run `prisma migrate deploy` as an explicit, single-runner step
      before rolling out new app instances — never rely on the container
      entrypoint or `prisma db push`.
- [ ] Point the load balancer/orchestrator's liveness probe at
      `/api/health` and readiness probe at `/api/health/ready`.
- [ ] Configure the container's/platform's HTTPS termination — HSTS is
      emitted automatically once `NODE_ENV=production`, but only take
      effect correctly behind real TLS termination.
- [ ] Ship stdout/stderr JSON log lines to a log aggregator; the shape is
      ready for that today (§7).
- [ ] Decide on and configure a real email provider before launch
      (`ConsoleEmailSender` must not run in production — see §17).
- [ ] If scaling beyond a single instance, implement the deferred
      Redis-backed `RateLimitRepository` (§14, §29) — the in-memory
      limiter under-enforces (not over-enforces) across multiple
      instances.
- [ ] Re-run `npm run build`, `npm test`, and `npx prisma validate` in
      the real target environment (not this sandbox) before deploying —
      see §25's environmental caveat.

## 30. Future improvements

- Nonce-based CSP (`script-src`/`style-src` without `'unsafe-inline'`),
  threading a per-request nonce through `src/app/layout.tsx`.
- A Redis-backed `RateLimitRepository` once `REDIS_URL` is actually
  provisioned in an environment (drop-in swap, see §14).
- Migrate the ~100 ad hoc `console.*` call sites to the structured
  logger incrementally, module by module.
- Retrofit Server Actions to route unexpected errors through
  `http-error-response.ts`'s logging (or an equivalent Server-Action-
  shaped variant) for consistent server-side observability, not just
  Route Handlers.
- Integrate a real error-tracking/tracing SDK (Sentry/OpenTelemetry) once
  the team selects one — `logger.ts`/`http-error-response.ts` are the
  intended seams.
- A background job/cron mechanism if async work (retention/cleanup for
  Module 24's `SecurityEvent` rows, scheduled notification digests, etc.)
  grows beyond synchronous best-effort calls.
- A real production email provider, replacing `ConsoleEmailSender`.
