# Module 39 — Sentry + CI/CD Hardening

## 1. Objective

Add production error reporting (Sentry) behind a Clean Architecture port,
wire it into every place an unexpected failure can currently occur (Route
Handlers, the workflow-expiration background job, domain event
subscribers, and the client-side root error boundary), validate its
configuration at startup, and harden the CI pipeline so a broken build,
lint failure, type error, or failing test can never reach `main` silently.
Explicitly does not implement BullMQ, does not change the `EventBus`
architecture, and does not touch Payment, Tax Engine, or GDPR business
logic.

## 2. Existing infrastructure reused (not duplicated)

- `application/ports/failure-reporter.ts`'s `FailureReporter` port and
  `ConsoleFailureReporter` (Module 37) — untouched. This module adds the
  Sentry-backed implementation the port's own doc comment already
  anticipated; it does not change the interface or any of the ~30
  use-case/subscriber call sites that depend on it.
- `infrastructure/config/env.ts`'s zod schema and fail-fast pattern
  (Module 25) — extended with four more variables, same
  `.superRefine()`-gated production-only strictness as `AUTH_SECRET`/
  `NEXT_PUBLIC_APP_URL`.
- `infrastructure/observability/logger.ts` (Module 25) — every new
  reporter still logs through it, so nothing about local log output
  changes; Sentry is additive, not a replacement.
- `infrastructure/observability/http-error-response.ts` (Module 25) — had
  zero call sites before this module; wired into `error.ts`'s reporting
  path (see §4) and left otherwise unchanged.
- `.github/workflows/ci.yml` — extended with two additional steps
  (`Prisma generate`, a split `Integration tests` step), not replaced.

## 3. New ports and implementations

| File | Purpose |
|---|---|
| `application/ports/error-reporter.ts` | `ErrorReporter` port — `reportException`/`reportMessage`, tags/extra/user context, `NullErrorReporter` default. The general-purpose counterpart to `FailureReporter` (Module 37), which stays deliberately narrow to its one event-subscriber use case. |
| `infrastructure/observability/console-error-reporter.ts` | Dev-mode `ErrorReporter` — routes through `logger`, mirrors `ConsoleFailureReporter` exactly. |
| `infrastructure/observability/sentry-client.ts` | Owns loading/initializing `@sentry/nextjs` exactly once per process. Dynamic `import()`, never a top-level one — Sentry is not loaded at all unless `SENTRY_DSN` is set, and a broken/missing install degrades to "unavailable", never a crash. |
| `infrastructure/observability/sentry-error-reporter.ts` | Production `ErrorReporter` — wraps each report in a Sentry scope (tags/extra/user), falls back to `logger` if Sentry can't be reached. |
| `infrastructure/observability/sentry-failure-reporter.ts` | Production `FailureReporter` — the drop-in replacement `failure-reporter.ts`'s own doc comment described. Built on top of `ErrorReporter` rather than calling the Sentry SDK directly; extracts `EventDispatchError.failures` into Sentry's extra context when present. Still always logs through `logger` too. |
| `infrastructure/observability/error-reporter-factory.ts` | `createErrorReporter()` — the one place that decides `SentryErrorReporter` vs. `ConsoleErrorReporter`, driven by `isSentryConfigured()`. Memoized singleton per process. |
| `infrastructure/observability/failure-reporter-factory.ts` | `createFailureReporter()` — same decision for `FailureReporter`. This is what every `compose.ts` now calls instead of `new ConsoleFailureReporter()`. |
| `infrastructure/observability/types/sentry-nextjs-ambient.d.ts` | Fallback ambient type declaration so the codebase type-checks even where `npm install` hasn't fetched `@sentry/nextjs` yet. Safe to delete once every environment has the real package installed with its own types. |

## 4. Global error reporting call sites

- **Route Handlers using `toHttpErrorResponse`**: the unexpected-error
  branch now calls `createErrorReporter().reportException(...)`. The
  `DomainError` branch (expected validation/not-found/etc. failures)
  never does — this is the single place that draws the "expected vs.
  unexpected" line for every current and future Route Handler that
  adopts this helper.
- **`/api/cron/expire-workflows`, `/api/user/language`,
  `/api/health/ready`**: each already had its own `catch` block (they
  don't route through `toHttpErrorResponse`); each now also calls
  `createErrorReporter().reportException(...)` in the unexpected-failure
  branch only, alongside the existing `logger.error` call — no response
  shape changes.
- **`instrumentation.ts`'s `onRequestError`**: Next.js's own global
  error-reporting hook, invoked automatically for any exception that
  escapes a Server Component/Route Handler/Server Action *uncaught* —
  the backstop for a route that doesn't have its own explicit reporting
  call. Filters out `DomainError` the same way; everything else is
  reported with `routePath`/`routeType`/`routerKind` tags.
- **Event subscribers**: unchanged at the call-site level — every
  `compose.ts` that previously did `new ConsoleFailureReporter()` now
  calls `createFailureReporter()` instead (8 files: `admin`, `dispute`,
  `gdpr`, `verification`, `company-verification`, `company-invitation`,
  `company-membership`, `support-ticket`). No use case or subscriber
  changed.
- **`src/app/error.tsx`** (client-side root error boundary): reports to
  Sentry's browser SDK when `NEXT_PUBLIC_SENTRY_DSN` is set, via a
  dynamic `import("@sentry/nextjs")` guarded by that check; falls back to
  the existing `console.error` otherwise.
- **Future BullMQ workers** (explicitly not implemented in this module):
  `ErrorReporter`/`FailureReporter` are both process-agnostic ports with
  no dependency on Next.js's request/response cycle — a future worker
  constructs the same `createErrorReporter()`/`createFailureReporter()`
  and reports exactly the same way a Route Handler does today.

## 5. Environment validation

Four new variables in `infrastructure/config/env.ts`:

| Variable | Required? | Notes |
|---|---|---|
| `SENTRY_DSN` | Production only (fails startup fast if missing — see `.superRefine`) | Server-side DSN. Optional in development/test — Sentry stays fully inert. |
| `NEXT_PUBLIC_SENTRY_DSN` | Never required | Browser-side DSN read by `error.tsx`. Deliberately separate from `SENTRY_DSN` — anything under `NEXT_PUBLIC_*` is inlined into the client bundle. |
| `SENTRY_ENVIRONMENT` | Never required | Defaults to `NODE_ENV`. |
| `SENTRY_TRACES_SAMPLE_RATE` | Never required | 0–1, defaults to 0 (errors only, no tracing). |

The production-only `SENTRY_DSN` check is exempted during the Next.js
build phase (`NEXT_PHASE === "phase-production-build"`), the same
carve-out `AUTH_SECRET`/`NEXT_PUBLIC_APP_URL`'s existing checks already
use — `next build` forces `NODE_ENV=production` for the build itself even
in CI, where no real Sentry project exists yet.

## 6. CI/CD hardening

`.github/workflows/ci.yml` now runs, in order, failing the job
immediately on the first failing step (GitHub Actions' default
behavior — no `continue-on-error` is set anywhere in this workflow):

1. `npm ci`
2. `npm run prisma:generate` (explicit step; `postinstall` already runs
   this too — kept explicit per this module's requirement for a visible,
   independently re-runnable step)
3. `npm run typecheck`
4. `npm run lint`
5. `npx prisma validate` / `npm run prisma:migrate:deploy` / `npx prisma
   migrate status` (unchanged from Module 25)
6. `npm run test:unit` (new script: `vitest run tests/unit`)
7. `npm run test:integration` (new script: `vitest run tests/integration`
   — previously combined with unit tests under a single `npm run test`
   step; split so a unit vs. integration failure is distinguishable at a
   glance in the Actions UI)
8. `npm run build`

No deployment step was added — out of scope per this module's
requirements.

## 7. Local development

Leave `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` unset. `createErrorReporter()`/
`createFailureReporter()` both resolve to their console implementations,
`sentry-client.ts` never attempts to load `@sentry/nextjs`, and
`error.tsx` never attempts the client-side import. No Sentry account, DSN,
or network access is needed to run the app or its test suite locally.

## 8. Production configuration

Set `SENTRY_DSN` (and `NEXT_PUBLIC_SENTRY_DSN` if browser-side reporting
is wanted) in the deployment environment. `env.ts` refuses to start the
process at all if `SENTRY_DSN` is missing and `NODE_ENV=production`
outside the build phase — this is intentional fail-fast behavior, not a
bug: a production deployment must never silently run with no error
reporting. `SENTRY_ENVIRONMENT`/`SENTRY_TRACES_SAMPLE_RATE` are optional
tuning knobs.

## 9. Enabling/disabling Sentry

There is no separate on/off flag — presence of `SENTRY_DSN` (server) /
`NEXT_PUBLIC_SENTRY_DSN` (browser) is the single source of truth,
consumed via `isSentryConfigured()` in `sentry-client.ts`. To disable
Sentry temporarily in an environment that would otherwise require it
(e.g. a staging deploy), there is no override — the variable must be
genuinely unset, which for `NODE_ENV=production` will also refuse to
start; this is deliberate (see §5).

## 10. Architecture decisions

- **Application layer never depends on the Sentry SDK.** Every use case,
  subscriber, and Route Handler depends only on `ErrorReporter`/
  `FailureReporter`. `@sentry/nextjs` is imported exclusively from
  `infrastructure/observability/sentry-client.ts` and the two Sentry
  reporter classes.
- **`ErrorReporter` vs. `FailureReporter`.** Kept as two ports rather than
  merging them: `FailureReporter` (Module 37) is intentionally narrow —
  one method, no context shape — for its one specific call site (a
  subscriber failing after the triggering operation already succeeded).
  `ErrorReporter` is the general-purpose port every other call site uses.
  `SentryFailureReporter` is built on top of `SentryErrorReporter`
  precisely so the "how to safely reach Sentry, falling back to the
  logger" logic exists in exactly one place.
- **Dynamic import, never a top-level one.** `@sentry/nextjs` is loaded
  lazily and only when configured — this keeps local development and
  most CI steps free of any Sentry network dependency, and keeps a
  broken/missing install from crashing the entire app rather than just
  disabling error reporting.
- **`onRequestError` as a backstop, not the primary mechanism.** Explicit
  `reportException` calls at each existing `catch` block remain the
  primary, precise reporting path (they know exactly what route/context
  they're in); `instrumentation.ts`'s `onRequestError` exists in addition,
  for whatever isn't caught by application code.
- **DI wiring stays at the `compose.ts` level.** Only the one line
  constructing `failureReporter` changed in each of the 8 `compose.ts`
  files — no use case or subscriber constructor signature changed.

## 11. Deferred / explicitly out of scope

- BullMQ workers (not implemented — ports are ready for it, per this
  module's requirements).
- EventBus architecture changes (none made).
- Sentry's build-time source-map upload plugin (`withSentryConfig`) —
  this module only uses Sentry's runtime capture APIs
  (`init`/`captureException`/`captureMessage`/scopes), not the Next.js
  build plugin, which would require additional auth-token configuration
  and build-time network access out of scope here.
- Retries/queues (none introduced).
- A separate Sentry on/off flag distinct from DSN presence (see §9).
