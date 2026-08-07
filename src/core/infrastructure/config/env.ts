import "server-only";

import { z } from "zod";

/**
 * Validated, typed environment configuration.
 *
 * Import `env` instead of reading `process.env` directly anywhere else in
 * the codebase. This is the single boundary where untyped, unvalidated
 * environment input is converted into a trustworthy shape — consistent
 * with Clean Architecture's principle of validating at the edges.
 *
 * Fails fast and loudly at startup if a required variable is missing or
 * malformed, rather than surfacing as a confusing runtime error later
 * (Module 25 — Production Infrastructure).
 *
 * Server-only boundary: this module reads secrets (DB credentials, OAuth
 * secrets, Stripe keys, Cloudinary API secret, the Auth.js secret). It
 * must never be imported from a Client Component or any code that ends up
 * in the browser bundle.
 *
 * This is enforced via the `server-only` package rather than a runtime
 * `typeof window !== "undefined"` check. That check was tried first and
 * reverted — Vitest's `jsdom` test environment defines a global `window`
 * for *every* test file regardless of whether the code under test is
 * server-only or client-only, so the check fired as a false positive for
 * any test that merely imported this module (or anything that transitively
 * imports it) on the server side, which is the normal, correct way to unit
 * test server-only code. `typeof window` cannot distinguish "really running
 * in a browser" from "running in a test environment that happens to define
 * `window`".
 *
 * `server-only` instead enforces the boundary at the framework/bundler
 * level: Next.js's webpack build sets a `react-server` resolve condition
 * for the entire server module graph (Server Components, Route Handlers,
 * Server Actions), which makes `server-only`'s package.json `exports`
 * map resolve to a no-op file there — but resolves to a throwing
 * implementation for any module reachable from the *client* bundle
 * (where that condition is absent), which is the actual boundary this
 * guards. Outside of Next's own bundler — e.g. under plain Node.js
 * module resolution, which is what Vitest uses — neither condition is
 * active and `server-only` falls back to its throwing implementation
 * too. `vitest.config.ts` therefore aliases `server-only` to an explicit
 * no-op stub (`tests/test-utils/server-only-stub.ts`) so importing
 * server-only code from a server-side unit test — a legitimate, intended
 * use — doesn't trip the same guard meant for an actual client bundle.
 */

const isProductionRuntime = process.env.NODE_ENV === "production";

/**
 * Module 39 — Sentry + CI/CD Hardening: treats an empty-string env value
 * as absent, for the `z.preprocess` calls below (`SENTRY_DSN`/
 * `NEXT_PUBLIC_SENTRY_DSN`) — see those fields' own comments for why.
 */
function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

/**
 * Base schema, shared across environments. Secrets that are hard
 * requirements in production (Stripe, Cloudinary) are still required in
 * every environment today because there is no environment-specific
 * wiring to make them optional in dev without touching unrelated modules
 * (Payment/Stripe Connect — Module 12 — and Storage) — this preserves
 * that existing behavior. What Module 25 adds on top is: stricter shape
 * validation (URLs, enums, numeric bounds) and additional
 * production-only checks (see `.superRefine` below) that only reject
 * genuinely unsafe production configuration, never dev/test.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // --- App ---
    NEXT_PUBLIC_APP_URL: z.string().url(),

    // --- Observability ---
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // --- Database (PostgreSQL via Prisma) ---
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    // --- Email (Resend) ---
    RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
    EMAIL_FROM: z.string().min(1, "EMAIL_FROM is required"),

    // --- Auth.js ---
    AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
    AUTH_URL: z.string().url(),
    // Required for Auth.js v5 when self-hosting behind a reverse proxy
    // (Docker/any non-Vercel host) rather than Vercel's own platform
    // integration — see auth-config.ts's `trustHost`.
    AUTH_TRUST_HOST: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    // Optional: OAuth providers can be configured selectively. A provider
    // with an empty clientId/clientSecret simply won't work at sign-in time
    // rather than crashing the app at startup — useful for local dev with
    // only email/password configured.
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_APPLE_ID: z.string().optional(),
    AUTH_APPLE_SECRET: z.string().optional(),
    AUTH_FACEBOOK_ID: z.string().optional(),
    AUTH_FACEBOOK_SECRET: z.string().optional(),

    // --- Stripe Connect (Module 12 owns the business logic; this module
    // only validates that the client can be constructed safely) ---
    STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
    STRIPE_PUBLISHABLE_KEY: z.string().min(1, "STRIPE_PUBLISHABLE_KEY is required"),
    STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
    STRIPE_CONNECT_CLIENT_ID: z.string().optional(),

    // --- Cloudinary ---
    CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
    CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
    CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),

    // --- Redis (optional — Module 25 reserved this variable; Module 44
    // — Redis Infrastructure — is what actually consumes it) ---
    // Still optional and unset by default: a single-instance deployment
    // (local dev, most CI runs) never needs Redis, and every consumer
    // (`cache-service-factory.ts`, `rate-limit-repository-factory.ts`,
    // `lock-service-factory.ts`) falls back to a correct in-memory
    // implementation when this is unset — never a startup failure. When
    // set, `redis-client-factory.ts`'s `getRedisClient()` constructs the
    // shared connection every Redis-backed service reuses, and
    // `CacheService`/`RateLimitRepository`/`DistributedLock` all switch
    // to their Redis-backed implementations automatically, with no
    // caller changes. Accepts `redis://` and `rediss://` (TLS) — see
    // `infrastructure/cache/redis-client.ts`'s `parseRedisUrl`.
    REDIS_URL: z.string().url().optional(),

    // --- Geocoding provider (Module 27 — Spain Location Services) ---
    // Selects which `GeocodingProvider` implementation
    // `createGeocodingProvider()` (infrastructure/geocoding/geocoding-provider-factory.ts)
    // constructs. Defaults to `STATIC` — the network-free
    // `StaticCityGeocodingProvider` — via `.catch()`, not just
    // `.default()`: `.catch()` also swallows an *invalid* value (a typo, a
    // stray value left over from another environment) and falls back to
    // `STATIC` instead of throwing and failing the entire app's startup
    // over a misconfigured, non-critical setting. This is the hard
    // guarantee behind "the application must never accidentally call a
    // real external API" — no outbound geocoding HTTP request can ever
    // happen unless `GEOCODING_PROVIDER` is deliberately, validly set to
    // `MAPBOX`/`GOOGLE`/`HERE`/`OSM` *and* (for the first three) the
    // matching API key is non-empty; every other case — unset, empty,
    // misspelled, or a real provider without its key — resolves to
    // `STATIC` at either this layer or the factory's own fallback (see
    // `geocoding-provider-factory.ts`), never a startup crash and never a
    // silent real network call.
    GEOCODING_PROVIDER: z.enum(["STATIC", "MAPBOX", "GOOGLE", "HERE", "OSM"]).catch("STATIC"),
    // API keys for the providers above. Deliberately optional and allowed
    // to be empty in every environment (including production) — there is
    // no production key yet, and requiring one here would make the app
    // fail to start over a provider that isn't even selected. OSM
    // (Nominatim) needs no key at all.
    MAPBOX_API_KEY: z.string().optional(),
    GOOGLE_GEOCODING_API_KEY: z.string().optional(),
    HERE_API_KEY: z.string().optional(),

    // --- Workflow expiration cron (Module 28 — Workflow Completion) ---
    // Shared-secret bearer token the cron route
    // (src/app/api/cron/expire-workflows/route.ts) requires on every
    // request's `Authorization: Bearer <token>` header — the standard
    // Vercel Cron pattern (Vercel signs its own scheduled requests with
    // whatever value is configured here; see vercel.json's `crons` entry
    // and that route's own doc comment for the full authorization
    // reasoning). Optional so every environment that never configures
    // scheduled cron (local dev, most CI runs) doesn't fail startup over
    // it — the route itself refuses every request with a 503 if this is
    // unset, rather than falling back to an insecure "no check" behavior.
    CRON_SECRET: z.string().optional(),

    // --- Background jobs (Module 45 — Background Jobs) ---
    // Selects how the single platform `EventBus` dispatches to its
    // subscribers. Unset or `"false"` (the default) keeps the Module 34
    // `SynchronousEventBus` exactly as it has always behaved — handlers
    // run inline, in the publisher's call stack. `"true"` swaps in
    // `QueuedEventBus` (infrastructure/events/queued-event-bus.ts), which
    // implements the identical `EventBus` port and moves handler
    // execution onto the job queue, with retries, dead-lettering, and
    // per-handler idempotency.
    //
    // Deliberately opt-in rather than "on whenever REDIS_URL is set",
    // unlike `CacheService`/`RateLimitRepository`/`DistributedLock`
    // (Module 44). Those three swap between implementations with
    // identical observable behavior; this one changes *delivery
    // semantics* for domain events — from "the handler has run by the
    // time publish() resolves" to "the handler will run, at least once".
    // A change of that kind to compliance-relevant audit-log subscribers
    // must be a deliberate deployment decision, never a side effect of
    // configuring a cache. See docs/MODULE_45_BACKGROUND_JOBS.md.
    //
    // Uses the same `emptyStringToUndefined` preprocessing as SENTRY_DSN
    // below, for the same `.env`-file convention reason.
    EVENT_QUEUE_ENABLED: z.preprocess(emptyStringToUndefined, z.enum(["true", "false"]).optional()),
    // How many jobs one worker runs concurrently (BullMQ's `concurrency`).
    // `.catch()` rather than `.default()` — a typo in an operational tuning
    // knob must never fail application startup; it falls back to the safe
    // default, exactly like GEOCODING_PROVIDER above.
    QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).catch(5),
    // Total attempts per job before it is dead-lettered, inclusive of the
    // first. `.catch()` for the same reason as QUEUE_CONCURRENCY.
    QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).catch(3),

    // --- Caching layer (Module 46 — Caching Layer) ---
    // Root prefix `CacheKeyBuilder` (application/services/cache/) prepends
    // to every key this module writes/reads — lets multiple environments
    // or apps safely share one Redis instance/DB without their cache
    // entries colliding. `.catch()` rather than `.default()` because a
    // malformed value here is an operational typo, not something that
    // should fail startup. Optional; `compose.ts` falls back to
    // `CacheKeyBuilder`'s own default (`"cache"`) when unset.
    CACHE_KEY_PREFIX: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
    // Debugging/testing escape hatch: when `"true"`, every `CacheManager`
    // read is treated as a miss (the loader always runs; results are
    // still written, so the cache stays warm for other instances) — see
    // `CacheManager`'s own `bypass` option. Unset or `"false"` (the
    // default) is the normal, cache-enabled behavior everywhere,
    // including production. Uses the same `emptyStringToUndefined`
    // preprocessing as `EVENT_QUEUE_ENABLED` above, for the same
    // `.env`-file convention reason.
    CACHE_BYPASS_ENABLED: z.preprocess(emptyStringToUndefined, z.enum(["true", "false"]).optional()),

    // --- Error reporting (Module 39 — Sentry + CI/CD Hardening) ---
    // `SENTRY_DSN` gates every Sentry-backed implementation in
    // `infrastructure/observability/` (see `sentry-client.ts`): unset
    // anywhere → Sentry stays fully inert and `createErrorReporter()`/
    // `createFailureReporter()` fall back to their console-based
    // implementations, so local development never needs a Sentry account.
    // Required in production (see `.superRefine` below) — a production
    // deployment must fail fast rather than silently run with no error
    // reporting.
    // `.env`/`.env.production`-style files in this codebase conventionally
    // mark an unset optional variable as `""` (see e.g. `REDIS_URL`,
    // `MAPBOX_API_KEY` below) rather than omitting the line entirely.
    // `z.string().url()` rejects `""` outright (it isn't a valid URL), so
    // both DSN fields are preprocessed to treat an empty string exactly
    // like an absent variable — before the `.url()` check runs — rather
    // than requiring every env file to omit the line instead of leaving it
    // empty. Does not weaken the production requirement below: `.superRefine`
    // still sees `undefined`, not `""`, and still fails fast.
    SENTRY_DSN: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    // Public/browser counterpart of `SENTRY_DSN`, read by `src/app/error.tsx`
    // (the root error boundary, which runs client-side). Deliberately a
    // separate variable, never `SENTRY_DSN` itself — anything under
    // `NEXT_PUBLIC_*` is inlined into the client bundle at build time, so
    // the server-only DSN must never be reused here. Optional in every
    // environment: a missing value simply means client-side (browser)
    // exceptions aren't reported, while server-side reporting (the
    // primary requirement) is unaffected.
    NEXT_PUBLIC_SENTRY_DSN: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    // Sentry's own "environment" tag, distinct from NODE_ENV so e.g. a
    // staging deployment that must run with NODE_ENV=production (to get
    // production build behavior) can still be told apart from real
    // production traffic inside Sentry. Falls back to NODE_ENV when unset
    // (see `sentry-client.ts`).
    SENTRY_ENVIRONMENT: z.string().optional(),
    // Fraction (0-1) of transactions Sentry samples for performance
    // tracing. Optional and defaults to 0 (tracing off, errors only) —
    // this module's scope is error reporting, not APM; left configurable
    // rather than hardcoded so it can be enabled later without another
    // env-layer change.
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;

    // `next build` unconditionally forces NODE_ENV=production for the
    // build itself (that's how Next.js produces an optimized bundle),
    // even when the actual deploy target is CI or a preview environment
    // running on placeholder secrets — see .github/workflows/ci.yml.
    // `NEXT_PHASE` is Next's own build-phase marker (`phase-production-build`
    // during `next build`, unset during `next start`/actual request
    // handling), so this only skips the *strict* production checks below
    // during the build step itself. Every other validation above (types,
    // URL shape, required-ness) still applies at build time; only the
    // "is this a real, safely-configured production deployment" checks
    // are deferred to actual server startup, where the real environment
    // is guaranteed to be present.
    if (process.env.NEXT_PHASE === "phase-production-build") return;

    // Never let a production deployment start on an accidentally weak or
    // placeholder secret — a common source of real-world session/CSRF
    // compromises. 32 chars matches `openssl rand -base64 32` / `npx auth
    // secret` output length.
    if (value.AUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET must be at least 32 characters in production.",
      });
    }

    // Production traffic must be served over HTTPS for secure cookies,
    // HSTS, and OAuth redirect URIs to behave correctly.
    if (!value.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "NEXT_PUBLIC_APP_URL must use https:// in production.",
      });
    }
    if (!value.AUTH_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_URL"],
        message: "AUTH_URL must use https:// in production.",
      });
    }

    if (
      value.STRIPE_SECRET_KEY.startsWith("sk_test_") ||
      value.STRIPE_PUBLISHABLE_KEY.startsWith("pk_test_")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_SECRET_KEY"],
        message: "Test-mode Stripe keys (sk_test_/pk_test_) must not be used in production.",
      });
    }

    // Module 39 — Sentry + CI/CD Hardening: a production deployment must
    // fail fast if it would otherwise run with no error reporting at all,
    // rather than silently operating unobserved until someone notices.
    // Every other environment (development, test, and the `next build`
    // build-phase case already exempted above) is unaffected — Sentry
    // stays fully optional there.
    if (!value.SENTRY_DSN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SENTRY_DSN"],
        message: "SENTRY_DSN is required in production for error reporting (Module 39).",
      });
    }
  });

function parseEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Field names only — never log the values themselves, some of which
    // are the very secrets this validation exists to protect.
    const fieldErrors = parsed.error.flatten().fieldErrors;
    // Startup-time fatal diagnostic, necessarily precedes logger.ts's own
    // init (which itself depends on `env` being valid) — a plain
    // console.error is the correct tool here, not a gap.
    console.error("Invalid environment configuration. Affected variables:", Object.keys(fieldErrors));
    console.error(fieldErrors);
    throw new Error(
      "Invalid environment variables — see log above. The application cannot start safely.",
    );
  }

  return parsed.data;
}

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

// Re-exported for readability at call sites that only care about the
// process's declared NODE_ENV before `env` has necessarily been imported
// (e.g. very early startup diagnostics). Prefer `isProduction`/`env.NODE_ENV`
// once `env` is available.
export { isProductionRuntime };
