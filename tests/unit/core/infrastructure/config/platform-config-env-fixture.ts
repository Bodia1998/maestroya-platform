import type { Env } from "@/infrastructure/config/env";

/**
 * Module 53 — Configuration & Secrets Management.
 *
 * A fully-populated, already-*typed* `Env` fixture for testing
 * `resolvePlatformConfig()` (`infrastructure/config/config-resolver.ts`)
 * and `EnvSecretsProvider` (`infrastructure/config/env-secrets-provider.ts`)
 * directly, with plain object literals — no `process.env` mutation, no
 * `vi.resetModules()` + re-import, unlike `env-fixture.ts`'s
 * `loadEnvWith()` (which exists specifically to test `envSchema` parsing
 * itself, a different concern from this module's).
 *
 * This is possible only because both of those modules take an `Env`
 * value as a plain function/constructor argument rather than importing
 * the `env` singleton themselves — see `config-resolver.ts`'s own doc
 * comment for why that was a deliberate design choice.
 */
export function buildTestEnv(overrides: Partial<Env> = {}): Env {
  const base: Env = {
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    LOG_LEVEL: "info",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/maestroya?schema=public",
    RESEND_API_KEY: "re_test_placeholder",
    EMAIL_FROM: "MaestroYa <noreply@maestroya.test>",
    SMS_PROVIDER: "mock",
    TWILIO_ACCOUNT_SID: undefined,
    TWILIO_AUTH_TOKEN: undefined,
    TWILIO_FROM_NUMBER: undefined,
    VERIFICATION_PROVIDER: "manual",
    PERSONA_API_KEY: undefined,
    PERSONA_TEMPLATE_ID: undefined,
    PERSONA_WEBHOOK_SECRET: undefined,
    PERSONA_API_BASE_URL: undefined,
    AUTH_SECRET: "test-auth-secret-at-least-32-characters-long",
    AUTH_URL: "https://app.example.test",
    AUTH_TRUST_HOST: true,
    AUTH_GOOGLE_ID: undefined,
    AUTH_GOOGLE_SECRET: undefined,
    AUTH_APPLE_ID: undefined,
    AUTH_APPLE_SECRET: undefined,
    AUTH_FACEBOOK_ID: undefined,
    AUTH_FACEBOOK_SECRET: undefined,
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_PUBLISHABLE_KEY: "pk_test_placeholder",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    STRIPE_PAYMENTS_WEBHOOK_SECRET: "whsec_payments_placeholder",
    STRIPE_CONNECT_CLIENT_ID: undefined,
    CLOUDINARY_CLOUD_NAME: "demo",
    CLOUDINARY_API_KEY: "123456",
    CLOUDINARY_API_SECRET: "abcdef",
    REDIS_URL: undefined,
    GEOCODING_PROVIDER: "STATIC",
    MAPBOX_API_KEY: undefined,
    GOOGLE_GEOCODING_API_KEY: undefined,
    HERE_API_KEY: undefined,
    CRON_SECRET: undefined,
    EVENT_QUEUE_ENABLED: undefined,
    QUEUE_CONCURRENCY: 5,
    QUEUE_MAX_ATTEMPTS: 3,
    CACHE_KEY_PREFIX: undefined,
    CACHE_BYPASS_ENABLED: undefined,
    SEARCH_PROVIDER: "none",
    SEARCH_INDEX_PREFIX: undefined,
    MEILISEARCH_HOST: undefined,
    MEILISEARCH_API_KEY: undefined,
    TYPESENSE_HOST: undefined,
    TYPESENSE_API_KEY: undefined,
    SEARCH_INDEXING_ENABLED: undefined,
    SEARCH_INDEX_BATCH_SIZE: 100,
    SENTRY_DSN: undefined,
    NEXT_PUBLIC_SENTRY_DSN: undefined,
    SENTRY_ENVIRONMENT: undefined,
    SENTRY_TRACES_SAMPLE_RATE: undefined,
    REALTIME_HEARTBEAT_INTERVAL_MS: 25_000,
    REALTIME_CONNECTION_TTL_MS: 90_000,
    REALTIME_WS_ENABLED: undefined,
    REALTIME_WS_PORT: 3001,
    REALTIME_MAX_CONNECTIONS_PER_USER: 10,
    ANALYTICS_REFRESH_ENABLED: undefined,
    ANALYTICS_CACHE_TTL_MS: 300_000,
    ANALYTICS_SCHEDULED_REFRESH_INTERVAL_MS: 900_000,
    TRACING_ENABLED: undefined,
    TRACING_EXPORTER: "console",
    OTEL_SERVICE_NAME: undefined,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_EXPORTER_HEADERS: undefined,
    FEATURE_FLAGS_ENABLED: "true",
    FEATURE_FLAGS_CONFIG: undefined,
    BACKUP_ENABLED: "false",
    BACKUP_STORAGE_DIR: "/var/backups/maestroya",
    BACKUP_RETENTION_DAYS: 30,
    BACKUP_MIN_RETAINED_BACKUPS: 3,
    BACKUP_FULL_INTERVAL_DAYS: 7,
    BACKUP_SCHEDULE_CRON: "0 2 * * *",
    // Module 90 — Automated Reconciliation & Financial Alerting.
    RECONCILIATION_SCHEDULE_CRON: "0 */6 * * *",
    RECONCILIATION_SCHEDULE_SCOPE: "FULL",
    RECONCILIATION_SCHEDULE_LIMIT: 500,
    READ_REPLICAS_ENABLED: "false",
    DATABASE_REPLICA_URLS: "",
    READ_REPLICA_SELECTION_STRATEGY: "ROUND_ROBIN",
    READ_REPLICA_DEFAULT_CONSISTENCY: "EVENTUAL",
    READ_REPLICA_MAX_STALENESS_MS: 5000,
    READ_REPLICA_MAX_LAG_MS: 30_000,
    READ_REPLICA_FAILURE_THRESHOLD: 3,
    READ_REPLICA_RECOVERY_THRESHOLD: 2,
    READ_REPLICA_HEALTH_STALE_MS: 60_000,
    HEALTH_CHECKS_ENABLED: "true",
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
    CIRCUIT_BREAKER_SUCCESS_THRESHOLD: 2,
    CIRCUIT_BREAKER_TIMEOUT_MS: 5000,
    CIRCUIT_BREAKER_RESET_TIMEOUT_MS: 30_000,
    LOAD_TEST_ENABLED: "false",
    LOAD_TEST_DEFAULT_SEED: 42,
    LOAD_TEST_REGRESSION_MINOR_PERCENT: 10,
    LOAD_TEST_REGRESSION_MODERATE_PERCENT: 25,
    LOAD_TEST_REGRESSION_SEVERE_PERCENT: 50,
    LOAD_TEST_REGRESSION_CRITICAL_PERCENT: 100,
  };

  return { ...base, ...overrides };
}
