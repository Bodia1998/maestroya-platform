import "server-only";

import type { Env } from "@/infrastructure/config/env";
import type { PlatformConfig } from "@/domain/entities/platform-config";

/**
 * Module 53 — Configuration & Secrets Management.
 *
 * Turns a validated `Env` (`infrastructure/config/env.ts`) into the
 * structured, namespaced `PlatformConfig` shape the rest of the
 * application reads — the same "decide once, from the validated env, in
 * a single named place" role `resolveTracingConfig()`
 * (`infrastructure/tracing/tracing-config.ts`) plays for tracing alone,
 * generalized across every subsystem instead of just one.
 *
 * A **pure function of its `Env` argument**, deliberately not reading the
 * module-level `env` singleton itself (unlike `resolveTracingConfig`,
 * which does). That makes this function directly unit-testable with
 * hand-built `Env`-shaped fixtures — no `vi.resetModules()` +
 * re-import dance required, the way testing `env.ts`-dependent code
 * normally needs (see `tests/unit/core/infrastructure/config/env-fixture.ts`'s
 * own doc comment on exactly that cost). `infrastructure/config/compose.ts`
 * is the one call site that supplies the real `env` singleton.
 *
 * Never throws: every field it reads from `Env` has already passed
 * `envSchema`'s validation (types, enums, numeric bounds) by the time
 * this runs, so there is nothing left here to fail on — this function's
 * only job is regrouping already-trustworthy data, never re-validating it.
 */
export function resolvePlatformConfig(env: Env): PlatformConfig {
  return {
    app: {
      url: env.NEXT_PUBLIC_APP_URL,
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
    },
    database: {
      provider: "postgresql",
      configured: Boolean(env.DATABASE_URL),
    },
    email: {
      provider: "resend",
      from: env.EMAIL_FROM,
      configured: Boolean(env.RESEND_API_KEY),
    },
    auth: {
      url: env.AUTH_URL,
      trustHost: env.AUTH_TRUST_HOST,
      configuredOAuthProviders: [
        env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET ? "google" : null,
        env.AUTH_APPLE_ID && env.AUTH_APPLE_SECRET ? "apple" : null,
        env.AUTH_FACEBOOK_ID && env.AUTH_FACEBOOK_SECRET ? "facebook" : null,
      ].filter((provider): provider is string => provider !== null),
    },
    payments: {
      provider: "stripe",
      connectEnabled: Boolean(env.STRIPE_CONNECT_CLIENT_ID),
      configured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_WEBHOOK_SECRET),
    },
    storage: {
      provider: "cloudinary",
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      configured: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET),
    },
    sms: {
      provider: env.SMS_PROVIDER,
      configured:
        env.SMS_PROVIDER === "mock"
          ? true
          : Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
    },
    search: {
      provider: env.SEARCH_PROVIDER,
      indexPrefix: env.SEARCH_INDEX_PREFIX ?? null,
      indexingEnabled: env.SEARCH_INDEXING_ENABLED !== "false",
      batchSize: env.SEARCH_INDEX_BATCH_SIZE,
    },
    geocoding: {
      provider: env.GEOCODING_PROVIDER,
    },
    cache: {
      keyPrefix: env.CACHE_KEY_PREFIX ?? null,
      bypassEnabled: env.CACHE_BYPASS_ENABLED === "true",
      redisConfigured: Boolean(env.REDIS_URL),
    },
    queue: {
      eventQueueEnabled: env.EVENT_QUEUE_ENABLED === "true",
      concurrency: env.QUEUE_CONCURRENCY,
      maxAttempts: env.QUEUE_MAX_ATTEMPTS,
    },
    realtime: {
      heartbeatIntervalMs: env.REALTIME_HEARTBEAT_INTERVAL_MS,
      connectionTtlMs: env.REALTIME_CONNECTION_TTL_MS,
      websocketEnabled: env.REALTIME_WS_ENABLED === "true",
      websocketPort: env.REALTIME_WS_PORT,
      maxConnectionsPerUser: env.REALTIME_MAX_CONNECTIONS_PER_USER,
    },
    analytics: {
      refreshEnabled: env.ANALYTICS_REFRESH_ENABLED !== "false",
      cacheTtlMs: env.ANALYTICS_CACHE_TTL_MS,
      scheduledRefreshIntervalMs: env.ANALYTICS_SCHEDULED_REFRESH_INTERVAL_MS,
    },
    tracing: {
      enabled: env.TRACING_ENABLED === "true",
      exporter: env.TRACING_EXPORTER,
      serviceName: env.OTEL_SERVICE_NAME ?? "maestroya-platform",
      otlpEndpointConfigured: Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT),
    },
    observability: {
      sentryConfigured: Boolean(env.SENTRY_DSN),
      sentryClientConfigured: Boolean(env.NEXT_PUBLIC_SENTRY_DSN),
      sentryEnvironment: env.SENTRY_ENVIRONMENT ?? null,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? null,
    },
    featureFlags: {
      enabled: env.FEATURE_FLAGS_ENABLED === "true",
      hasConfigOverride: Boolean(env.FEATURE_FLAGS_CONFIG),
    },
  };
}

/**
 * Every `Env` field this module considers a **secret** — never safe to
 * log, expose in a diagnostics endpoint, or include in `PlatformConfig`
 * by value. This is the single source of truth `EnvSecretsProvider`
 * (`infrastructure/config/env-secrets-provider.ts`) reads to know what to
 * hold, and `ConfigService.describeConfig()`/`collectConfigHealth()` use
 * (indirectly, via `SecretsProvider.listKnownKeys()`) to build a complete
 * masked inventory.
 *
 * Deliberately broader than "the fields `envSchema` marks `.min(1,
 * required)`": it also covers every *optional*, provider-specific
 * credential (OAuth client secrets, geocoding/search API keys, Twilio
 * credentials, the OTLP exporter's auth headers, ...) — an unset optional
 * secret is still a secret, just one that happens to be absent right now.
 *
 * Deliberately excludes values that look secret-adjacent but are not
 * confidential by design: `STRIPE_PUBLISHABLE_KEY` (Stripe's own "safe to
 * embed in client-side code" key), `STRIPE_CONNECT_CLIENT_ID` and
 * `AUTH_GOOGLE_ID`/`AUTH_APPLE_ID`/`AUTH_FACEBOOK_ID` (OAuth *client ids*,
 * meant to appear in a redirect URL, unlike their paired `*_SECRET`
 * values), and `CLOUDINARY_CLOUD_NAME` (an account identifier, not a
 * credential) — treating those as secrets would just make the masked
 * diagnostics view less useful without protecting anything.
 */
/**
 * The subset of `SECRET_ENV_KEYS` that `envSchema`'s base schema
 * (`infrastructure/config/env.ts`) requires unconditionally, in every
 * environment (`.min(1, "... is required")`, not `.optional()`) — used by
 * `collectConfigHealth()` (`infrastructure/config/config-health.ts`) as a
 * defensive cross-check that these are really present at runtime. In
 * practice this can never actually be false: `parseEnv()` already threw
 * at process startup if any of them were missing, before this module's
 * `resolvePlatformConfig()` ever runs. The check exists anyway for the
 * same reason a health check is worth having at all — cheap insurance
 * against a future refactor of `env.ts` silently loosening one of these
 * fields without anyone noticing the operational-visibility signal it
 * used to provide.
 */
export const REQUIRED_SECRET_ENV_KEYS: readonly (keyof Env)[] = [
  "DATABASE_URL",
  "RESEND_API_KEY",
  "AUTH_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

export const SECRET_ENV_KEYS: readonly (keyof Env)[] = [
  "DATABASE_URL",
  "RESEND_API_KEY",
  "AUTH_SECRET",
  "AUTH_GOOGLE_SECRET",
  "AUTH_APPLE_SECRET",
  "AUTH_FACEBOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "REDIS_URL",
  "MAPBOX_API_KEY",
  "GOOGLE_GEOCODING_API_KEY",
  "HERE_API_KEY",
  "CRON_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "MEILISEARCH_API_KEY",
  "TYPESENSE_API_KEY",
  "SENTRY_DSN",
  "OTEL_EXPORTER_HEADERS",
];
