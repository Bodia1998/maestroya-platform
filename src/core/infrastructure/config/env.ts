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

    // --- SMS (Module 49 — SMS Notifications) ---
    // Selects which `SmsSender` implementation `createSmsSender()`
    // (infrastructure/sms/sms-sender-factory.ts) constructs. `.catch()`
    // rather than `.default()` — same "a typo in a swappable-backend
    // selector must degrade to the safe local option, never fail
    // startup" reasoning as `SEARCH_PROVIDER`/`GEOCODING_PROVIDER` above.
    // `mock` is the safe default: it sends nothing over the network,
    // keeping local dev/CI fully functional with no Twilio account.
    SMS_PROVIDER: z.enum(["mock", "twilio"]).catch("mock"),
    // Twilio REST API credentials. All optional in every environment,
    // including production, for the identical reason `MAPBOX_API_KEY`/
    // `HERE_API_KEY` are optional above: a provider that isn't selected
    // must never be a startup requirement. When `SMS_PROVIDER=twilio`,
    // `createSmsSender()` itself — not this schema — is the one place
    // that fails fast if any of the three is missing (see that file's
    // own doc comment), the same division of responsibility
    // `ResendEmailSender`/`RESEND_API_KEY` already has today (required
    // unconditionally here only because email has no swappable provider
    // yet; SMS does, so its keys follow the geocoding/search precedent
    // instead).
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

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

    // --- CQRS search engine (Module 47 — CQRS Search Engine) ---
    // Selects which `SearchIndexProvider` implementation
    // `createSearchProvider()`
    // (infrastructure/search/search-provider-factory.ts) constructs.
    // Defaults to `none` via `.catch()` — not `.default()` — for exactly
    // the reason `GEOCODING_PROVIDER` above documents: a typo in a
    // non-critical, swappable backend selector must degrade to the safe
    // local option, never fail the entire application's startup.
    //
    // `none` does **not** mean "search is disabled": it selects
    // `InMemorySearchProvider`, a fully functional per-process
    // implementation of the same port (see that class's own doc comment).
    // That is what makes the read model exercisable in local development
    // and in CI with no external engine running, the same way
    // `InMemoryCacheProvider`/`InMemoryJobStore` do for Modules 45/46.
    // A misconfigured or unreachable Meilisearch/Typesense is likewise
    // never fatal — the read side degrades to an empty, flagged result
    // (see `SearchReadModelUseCase`).
    SEARCH_PROVIDER: z.enum(["none", "meilisearch", "typesense"]).catch("none"),
    // Root name of the index/collection the read model is written to.
    // Combined with `SEARCH_INDEX_VERSION` (a code constant, not an env
    // var — see `search-index-name.ts`) into the effective index name, so
    // several environments can share one engine without colliding, the
    // same role `CACHE_KEY_PREFIX` plays for the caching layer.
    SEARCH_INDEX_PREFIX: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
    // Connection settings for the two supported engines. All optional in
    // every environment, including production: an engine that is not
    // selected must never be a startup requirement, and a selected engine
    // missing its host falls back to the in-memory provider at the
    // factory rather than throwing (see `search-provider-factory.ts`) —
    // the identical "no outbound call can happen unless deliberately and
    // completely configured" guarantee `GEOCODING_PROVIDER` gives.
    MEILISEARCH_HOST: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    MEILISEARCH_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    TYPESENSE_HOST: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    TYPESENSE_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    // Master switch for *writing* to the index. Unset or `"true"` (the
    // default) keeps the event → job → worker indexing pipeline wired up.
    // `"false"` unsubscribes the indexing handlers and registers no
    // worker, leaving reads working against whatever is already indexed —
    // the operator's escape hatch for "stop hammering the engine while I
    // fix it", and the switch that makes a controlled, offline rebuild
    // possible. Deliberately separate from `SEARCH_PROVIDER`: turning
    // indexing off must not also change which engine reads go to.
    SEARCH_INDEXING_ENABLED: z.preprocess(emptyStringToUndefined, z.enum(["true", "false"]).optional()),
    // Documents per provider round trip during a batch/rebuild pass.
    // `.catch()` for the same "operational tuning knob must never fail
    // startup" reason as QUEUE_CONCURRENCY.
    SEARCH_INDEX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).catch(100),

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

    // --- Real-Time System (Module 48) ---
    // How often (ms) the SSE transport writes a `: heartbeat` keep-alive
    // comment to each connected stream — see `sse-transport.ts`. Also the
    // cadence a WebSocket client is expected to send its own `heartbeat`
    // control frame at. `.catch()` for the same "operational tuning knob
    // must never fail startup" reason as `QUEUE_CONCURRENCY`.
    REALTIME_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).max(120_000).catch(25_000),
    // How long (ms) a connection may go without a heartbeat before
    // `RealtimeHub.reapExpired` evicts it — must exceed
    // `REALTIME_HEARTBEAT_INTERVAL_MS` by a comfortable margin so one or
    // two missed beats (a slow network, not a dead client) don't cause a
    // false eviction.
    REALTIME_CONNECTION_TTL_MS: z.coerce.number().int().min(5000).max(600_000).catch(90_000),
    // Master switch reported by `getRealtimeHealth()`'s `transports.websocket`
    // field. The WebSocket transport (`RealtimeWebSocketServer`) itself is
    // always available to attach — this flag does not gate the SSE
    // transport (always on) or actually start anything by itself; it only
    // records, for operators, whether the separate WebSocket gateway
    // process (`scripts/realtime-gateway.ts` / `npm run realtime:gateway`
    // — see docs/MODULE_48_REALTIME_SYSTEM.md) is expected to be running
    // in this deployment, since that process's own health is not
    // otherwise visible to the main Next.js instance's `/api/health/ready`.
    REALTIME_WS_ENABLED: z.preprocess(emptyStringToUndefined, z.enum(["true", "false"]).optional()),
    // Port the standalone WebSocket gateway listens on when run via
    // `scripts/realtime-gateway.ts`. Irrelevant to the main Next.js
    // process. `.catch()` for the same reason as the tuning knobs above.
    REALTIME_WS_PORT: z.coerce.number().int().min(1).max(65_535).catch(3001),
    // Caps concurrent connections a single user may hold (multiple
    // devices/tabs) — a defensive bound against a runaway/misbehaving
    // client opening unbounded SSE streams. `.catch()`, same reasoning.
    REALTIME_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).max(100).catch(10),

    // --- Analytics Dashboard (Module 50 — CQRS Read Model) ---
    //
    // The automatic (event-driven + scheduled) refresh pipeline's kill
    // switch — opt-out, not opt-in, exactly like `SEARCH_INDEXING_ENABLED`:
    // with a functional cache-backed store as the default, refreshing is
    // free and local, and reads keep working regardless (see
    // `GetDashboardAnalyticsUseCase`'s on-demand live-recompute fallback),
    // so an operator's "stop refreshing while I investigate" switch should
    // default to on, not off.
    ANALYTICS_REFRESH_ENABLED: z.preprocess(emptyStringToUndefined, z.enum(["true", "false"]).optional()),
    // How long a cached dashboard snapshot may be served before the next
    // read forces a live recompute. `.catch()` — an operational tuning
    // knob, same reasoning as `QUEUE_CONCURRENCY`.
    ANALYTICS_CACHE_TTL_MS: z.coerce.number().int().min(1000).max(3_600_000).catch(300_000),
    // The periodic full-recompute interval (`JobScheduler`'s `{ every }`),
    // the backstop that keeps the dashboard fresh even if every
    // event-subscription happened to miss a change. `.catch()`, same
    // reasoning.
    ANALYTICS_SCHEDULED_REFRESH_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).catch(900_000),

    // --- Distributed Tracing (Module 51) ---
    //
    // Master switch. **Opt-in** (`"true"` to enable), unlike Module 47's
    // `SEARCH_INDEXING_ENABLED` and Module 50's `ANALYTICS_REFRESH_ENABLED`,
    // which are opt-out. The distinction those two document is exactly
    // the one applied here, with the opposite answer: they default on
    // because their default backend is local, free, and produces
    // something the app itself consumes. Tracing's default useful backend
    // is an *external* collector, and its output is consumed by an
    // operator, not by the platform — nothing in the application degrades
    // when it is off. That puts it in `EVENT_QUEUE_ENABLED`'s category
    // ("a deliberate deployment decision, never a side effect"), and it
    // is what makes the "when disabled there is effectively zero runtime
    // overhead" guarantee the default rather than a special case: with
    // this unset, `infrastructure/tracing/compose.ts` hands out
    // `nullTracer` and the OpenTelemetry SDK is never even imported.
    //
    // Uses the same `emptyStringToUndefined` preprocessing as
    // `EVENT_QUEUE_ENABLED`/`SENTRY_DSN`, for the same `.env`-file
    // convention reason.
    TRACING_ENABLED: z.preprocess(emptyStringToUndefined, z.enum(["true", "false"]).optional()),
    // Where finished spans go: `console` (local dev — stdout, no
    // collector needed), `otlp` (OTLP/HTTP to
    // `OTEL_EXPORTER_OTLP_ENDPOINT`), or `none` (spans created and
    // propagated, nothing exported). `.catch()` rather than `.default()`
    // — a typo in a swappable-backend selector must degrade to the safe
    // local option, never fail startup, exactly as `SEARCH_PROVIDER`/
    // `SMS_PROVIDER`/`GEOCODING_PROVIDER` document. `console` is that
    // safe option here: it makes no network call of any kind.
    TRACING_EXPORTER: z.enum(["console", "otlp", "none"]).catch("console"),
    // `service.name` on every exported span — how this application shows
    // up in the collector's service map. Optional; defaults to
    // `"maestroya-platform"` (see `tracing-config.ts`). The `OTEL_`
    // prefix is deliberate: these four are the OpenTelemetry
    // specification's own standard variable names, so an operator's
    // existing collector runbook applies unchanged, and a sidecar/agent
    // reading the same environment sees consistent values.
    OTEL_SERVICE_NAME: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
    // Base URL of the OTLP/HTTP collector (e.g.
    // `http://localhost:4318/v1/traces`). Optional in every environment,
    // including production, for the identical reason `MEILISEARCH_HOST`/
    // `TWILIO_ACCOUNT_SID` are: an exporter that isn't selected must
    // never be a startup requirement. Selecting `otlp` *without* it
    // degrades to `none` at the config layer (see `resolveTracingConfig`)
    // rather than constructing an exporter that would fail every flush —
    // and is a hard failure in production, see the `.superRefine` below.
    OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    // Comma-separated `key=value` pairs sent as headers on every OTLP
    // request — the collector's auth token, a tenant id, etc. The
    // OpenTelemetry specification's own `OTEL_EXPORTER_OTLP_HEADERS`
    // grammar; parsed leniently (a malformed pair is skipped, never
    // fatal) by `parseExporterHeaders`.
    OTEL_EXPORTER_HEADERS: z.preprocess(emptyStringToUndefined, z.string().optional()),

    // --- Feature Flags module ---
    //
    // Process-wide emergency kill switch — opt-out, unlike
    // TRACING_ENABLED: with the default in-memory/config-backed provider,
    // feature-flag evaluation is free, local, and fail-closed on its own
    // (see FeatureFlagService.evaluate), so this exists purely as an
    // operator's single "force every flag off" lever (e.g. a bad rollout
    // rule is causing production incidents and there's no time to fix
    // individual flags), not a routine deployment toggle. `.catch()`
    // rather than `.default()`, same "a typo in an operational switch
    // must never fail startup" reasoning as SMS_PROVIDER/GEOCODING_PROVIDER
    // — an invalid value degrades to "enabled" (the safe, normal-operation
    // default), never to an accidental platform-wide outage.
    FEATURE_FLAGS_ENABLED: z.enum(["true", "false"]).catch("true"),
    // Optional JSON array of flag definitions
    // (`featureFlagsConfigSchema` in application/dto/feature-flag.dto.ts),
    // merged on top of the code-defined defaults in
    // infrastructure/feature-flags/feature-flag-definitions.ts (by `key`;
    // an entry here replaces the matching default entirely, never a
    // partial merge). Left as a raw string here, not parsed by this
    // schema — env.ts intentionally never needs to know a feature flag's
    // shape; `feature-flag-definitions.ts`'s `parseFeatureFlagsConfig` is
    // the single place that validates it, and — same "a malformed
    // operational config must never fail startup" rule as every other
    // JSON-ish env var here — falls back to the code-defined defaults
    // alone (logging a warning) rather than throwing on invalid JSON.
    FEATURE_FLAGS_CONFIG: z.preprocess(emptyStringToUndefined, z.string().optional()),

    // --- Module 54 — Backup & Disaster Recovery ---
    //
    // Opt-in, like TRACING_ENABLED — a process that never sets this runs
    // with zero backup/recovery machinery: no scheduled job, no queue, no
    // worker. Correct for the common case (a managed Postgres provider
    // already runs its own point-in-time-recovery snapshots; this module
    // is the self-hosted-deployment path — see docker-compose.prod.yml's
    // own comment on Postgres deployment options and
    // docs/MODULE_54_BACKUP_AND_DISASTER_RECOVERY.md).
    BACKUP_ENABLED: z.enum(["true", "false"]).catch("false"),
    // Filesystem directory backup artifacts (database dumps and storage
    // manifests) are written to and read back from. Must be a writable,
    // durable path outside the container's own ephemeral layer in a real
    // deployment (e.g. a mounted volume) — this schema does not and
    // cannot verify that; `PgDumpDatabaseBackupProvider`/
    // `CloudinaryManifestStorageBackupProvider` fail loudly at backup
    // time if the directory cannot be written to.
    BACKUP_STORAGE_DIR: z.string().min(1).catch("/var/backups/maestroya"),
    // How long a backup remains a valid restore candidate before
    // retention enforcement expires it. `.catch()` — an operational
    // tuning knob, same reasoning as `QUEUE_CONCURRENCY`.
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).catch(30),
    // The floor on how many successful backups per target are always kept
    // regardless of age — see `RetentionPolicy`'s own doc comment for why
    // this exists.
    BACKUP_MIN_RETAINED_BACKUPS: z.coerce.number().int().min(1).max(1000).catch(3),
    // How often a FULL backup is required before an INCREMENTAL is
    // allowed again — see `BackupPlanningService`.
    BACKUP_FULL_INTERVAL_DAYS: z.coerce.number().int().min(1).max(365).catch(7),
    // The scheduled backup cadence, `JobScheduler`'s own 5-field cron
    // grammar (evaluated in UTC) — see `cron-expression.ts`. Runs once
    // daily at 02:00 UTC by default, a low-traffic window for this
    // platform's target market (Spain, UTC+1/+2).
    BACKUP_SCHEDULE_CRON: z.string().min(1).catch("0 2 * * *"),

    // --- Module 55 — Read Replicas ---
    //
    // Opt-in, like TRACING_ENABLED/BACKUP_ENABLED — a process that never
    // sets this reads and writes through `DATABASE_URL` alone, exactly
    // as every environment did before this module existed (see
    // docs/MODULE_55_READ_REPLICAS.md §7 for the full disabled-path
    // description).
    READ_REPLICAS_ENABLED: z.enum(["true", "false"]).catch("false"),
    // Comma-separated Postgres connection strings, one per replica —
    // the same grammar `OTEL_EXPORTER_HEADERS`/cron's field lists use
    // elsewhere in this file. Parsed (not validated as URLs) here:
    // `resolveReadReplicaConfig()` is the single place that turns this
    // into the typed, deduplicated, order-preserving list the rest of
    // the module reads, exactly like `resolveBackupConfig()` does for
    // `BACKUP_*`. Left as `z.string()` rather than `z.string().url()`
    // because Postgres connection strings often include a query string
    // Node's URL parser doesn't need to understand and this schema
    // shouldn't over-validate.
    DATABASE_REPLICA_URLS: z.string().catch(""),
    // Selects the `ReplicaSelector` `resolveReadReplicaConfig()` builds
    // (`domain/services/replica-selector.ts`). `.catch()` — same "a typo
    // in a swappable-backend selector must degrade to the safe default,
    // never fail startup" rule `SEARCH_PROVIDER`/`SMS_PROVIDER` follow.
    READ_REPLICA_SELECTION_STRATEGY: z.enum(["ROUND_ROBIN", "RANDOM", "LEAST_LAG"]).catch("ROUND_ROBIN"),
    // The module-wide default `ReadConsistencyLevel`
    // (`domain/services/read-consistency-policy.ts`) applied to a read
    // that does not explicitly request `STRONG` consistency via
    // `withReadConsistency()`. `EVENTUAL` — accept any replica
    // regardless of lag — is the default because it is the only choice
    // that actually offloads read traffic from the primary; an operator
    // who needs a staleness cap opts into `BOUNDED_STALENESS` explicitly.
    READ_REPLICA_DEFAULT_CONSISTENCY: z.enum(["STRONG", "EVENTUAL", "BOUNDED_STALENESS"]).catch("EVENTUAL"),
    // Only meaningful when READ_REPLICA_DEFAULT_CONSISTENCY=BOUNDED_STALENESS
    // (or a call site passes its own `ReadConsistencyPolicy` with this
    // same level) — the maximum replication lag, in milliseconds, a
    // replica may report and still be considered an acceptable read
    // source.
    READ_REPLICA_MAX_STALENESS_MS: z.coerce.number().int().min(0).max(300_000).catch(5000),
    // A replica whose most recently observed replication lag exceeds
    // this is `UNHEALTHY` (`ReplicaHealth.recordSuccess`) and excluded
    // from selection regardless of consistency level — the hard ceiling
    // beneath the softer, opt-in `READ_REPLICA_MAX_STALENESS_MS` bound
    // above; a replica this far behind is presumed to be malfunctioning
    // (e.g. a stuck WAL apply process), not merely offering slightly
    // stale reads.
    READ_REPLICA_MAX_LAG_MS: z.coerce.number().int().min(0).max(600_000).catch(30_000),
    // Consecutive ping/query failures before `ReplicaRouterService`
    // trips a replica to `UNHEALTHY` and stops routing reads to it.
    READ_REPLICA_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).catch(3),
    // Consecutive successes an `UNHEALTHY`/`DEGRADED` replica needs
    // before `ReplicaRouterService` trusts it with reads again.
    READ_REPLICA_RECOVERY_THRESHOLD: z.coerce.number().int().min(1).max(20).catch(2),
    // A replica's last recorded health signal older than this is treated
    // as stale and therefore ineligible for routing — protects against
    // routing to a replica whose failure went unnoticed because no
    // organic query happened to touch it. See
    // `ReplicaRouterServiceOptions.maxHealthAgeMs`'s own doc comment.
    READ_REPLICA_HEALTH_STALE_MS: z.coerce.number().int().min(1000).max(600_000).catch(60_000),

    // --- Module 56 — Health Checks & Circuit Breakers ---
    //
    // Master switch for the health-check/circuit-breaker framework
    // itself. Opt-out (default "true"), unlike TRACING_ENABLED/
    // BACKUP_ENABLED/READ_REPLICAS_ENABLED — this module adds pure
    // observability and failure-isolation around dependencies every
    // deployment already has, with safe in-process defaults and no
    // external backend of its own, the same category
    // `FEATURE_FLAGS_ENABLED` is in. "false" is an operator's escape
    // hatch only: `/api/health/diagnostics` and
    // `/api/health/circuit-breakers` report `disabled` rather than
    // executing any check, while `/api/health` and `/api/health/ready`
    // (Module 25) are entirely unaffected either way — this module never
    // touches those two routes.
    HEALTH_CHECKS_ENABLED: z.enum(["true", "false"]).catch("true"),
    // Consecutive failures, from CLOSED, before a circuit breaker trips
    // to OPEN — the default every breaker `infrastructure/health/
    // compose.ts` constructs uses unless it passes its own override.
    // `.catch()` — an operational tuning knob, same reasoning
    // `QUEUE_CONCURRENCY` documents.
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(50).catch(5),
    // Consecutive successes, from HALF_OPEN, before a breaker closes.
    CIRCUIT_BREAKER_SUCCESS_THRESHOLD: z.coerce.number().int().min(1).max(20).catch(2),
    // Per-execution timeout, in milliseconds, before a wrapped call is
    // treated as a failure (recorded separately, as a timeout — see
    // `CircuitBreakerMetrics.timeoutCount`).
    CIRCUIT_BREAKER_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).catch(5000),
    // How long, in milliseconds, a breaker stays OPEN before allowing a
    // single HALF_OPEN trial call — the automatic-recovery cadence.
    CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).catch(30_000),

    // --- Module 57 — Load Testing & Capacity Planning ---
    //
    // Opt-in, like BACKUP_ENABLED/READ_REPLICAS_ENABLED — a process that
    // never sets this still exposes every use case (the module runs
    // entirely in-process and on-demand, never as background machinery,
    // so there is nothing an unset flag needs to prevent from starting);
    // this flag only gates the optional admin-facing capacity-report
    // route, the same "kill switch an operator can flip without a
    // deploy" role BACKUP_ENABLED plays for its own route/health surface.
    LOAD_TEST_ENABLED: z.enum(["true", "false"]).catch("false"),
    // The default PRNG seed `BenchmarkRunner` uses when a caller does not
    // pin their own — kept fixed (not random) so "run a load test with no
    // arguments" is itself reproducible by default. `.catch()` — an
    // operational tuning knob, same reasoning `QUEUE_CONCURRENCY`
    // documents.
    LOAD_TEST_DEFAULT_SEED: z.coerce.number().int().min(0).max(2_147_483_647).catch(42),
    // Percentage-worse thresholds a metric's regression must cross to be
    // classified at each severity (see `RegressionThresholds` in
    // `domain/entities/performance-regression.ts`). Each must be strictly
    // greater than the previous — validated below in `.superRefine()`,
    // the same "cross-field validation of otherwise-independent env vars"
    // pattern CIRCUIT_BREAKER_*/READ_REPLICA_* already establish.
    LOAD_TEST_REGRESSION_MINOR_PERCENT: z.coerce.number().min(0).max(1000).catch(10),
    LOAD_TEST_REGRESSION_MODERATE_PERCENT: z.coerce.number().min(0).max(1000).catch(25),
    LOAD_TEST_REGRESSION_SEVERE_PERCENT: z.coerce.number().min(0).max(1000).catch(50),
    LOAD_TEST_REGRESSION_CRITICAL_PERCENT: z.coerce.number().min(0).max(1000).catch(100),
  })
  .superRefine((value, ctx) => {
    // Module 57 — each regression severity threshold must strictly exceed
    // the one below it, or `PerformanceRegression.compute`'s severity
    // classification would silently skip a level (or misclassify a small
    // regression as CRITICAL). A misconfigured operator override degrades
    // to the code-defined defaults above via `.catch()` already, so this
    // only catches the case where all four are still individually valid
    // numbers but inconsistent relative to each other.
    if (
      !(
        value.LOAD_TEST_REGRESSION_MINOR_PERCENT <= value.LOAD_TEST_REGRESSION_MODERATE_PERCENT &&
        value.LOAD_TEST_REGRESSION_MODERATE_PERCENT <= value.LOAD_TEST_REGRESSION_SEVERE_PERCENT &&
        value.LOAD_TEST_REGRESSION_SEVERE_PERCENT <= value.LOAD_TEST_REGRESSION_CRITICAL_PERCENT
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "LOAD_TEST_REGRESSION_*_PERCENT thresholds must be non-decreasing: MINOR <= MODERATE <= SEVERE <= CRITICAL.",
        path: ["LOAD_TEST_REGRESSION_MINOR_PERCENT"],
      });
    }

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

    // Module 49 — SMS Notifications: a production deployment that
    // deliberately opted into the real Twilio provider must not silently
    // fall back to no-op behavior for missing credentials — fail fast
    // here, the same "deliberate deployment decision, never a silent
    // gap" reasoning `SENTRY_DSN` above already applies. `SMS_PROVIDER`
    // itself stays `.catch("mock")` at the field level (a typo must
    // degrade safely); this only fires once `twilio` was genuinely and
    // validly selected.
    if (value.SMS_PROVIDER === "twilio") {
      if (!value.TWILIO_ACCOUNT_SID || !value.TWILIO_AUTH_TOKEN || !value.TWILIO_FROM_NUMBER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMS_PROVIDER"],
          message:
            "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are required in production when SMS_PROVIDER=twilio.",
        });
      }
    }

    // Module 51 — Distributed Tracing: a production deployment that
    // deliberately enabled tracing *and* selected the OTLP exporter must
    // not silently fall back to exporting nothing — identical reasoning
    // to the `SMS_PROVIDER=twilio` check directly above, and to
    // `SENTRY_DSN`'s. `TRACING_EXPORTER` itself stays `.catch("console")`
    // at the field level (a typo must degrade safely); this only fires
    // once `otlp` was genuinely and validly selected with tracing on.
    // Tracing left disabled — the default — is never a production
    // requirement here: unlike error reporting, an untraced deployment is
    // unobservable in one dimension, not unmonitored.
    if (value.TRACING_ENABLED === "true" && value.TRACING_EXPORTER === "otlp" && !value.OTEL_EXPORTER_OTLP_ENDPOINT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
        message:
          "OTEL_EXPORTER_OTLP_ENDPOINT is required in production when TRACING_ENABLED=true and TRACING_EXPORTER=otlp.",
      });
    }

    // Module 55 — Read Replicas: a production deployment that
    // deliberately opted into read-replica routing must not silently run
    // with zero replicas configured (which would route every read to the
    // primary anyway, defeating the point without saying so) — identical
    // reasoning to the `SMS_PROVIDER=twilio`/`TRACING_ENABLED` checks
    // above. `READ_REPLICAS_ENABLED` itself stays `.catch("false")` at the
    // field level; this only fires once it was genuinely and validly
    // turned on.
    if (value.READ_REPLICAS_ENABLED === "true" && value.DATABASE_REPLICA_URLS.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_REPLICA_URLS"],
        message: "DATABASE_REPLICA_URLS is required in production when READ_REPLICAS_ENABLED=true.",
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
