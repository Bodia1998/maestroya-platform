/**
 * Module 53 — Configuration & Secrets Management.
 *
 * The domain model for the platform's **structured, namespaced,
 * non-secret** configuration — plain, JSON-safe types with no behaviour,
 * the same convention `domain/entities/feature-flag.ts` establishes for
 * this codebase ("a value that gets stored/transported/read by pure
 * functions elsewhere, never a class with its own methods").
 *
 * This is deliberately *not* a re-typing of `Env`
 * (`infrastructure/config/env.ts`). `Env` is a flat bag of ~70 individual
 * environment variables — the correct shape for "validate everything
 * `process.env` gave us, once, at startup." `PlatformConfig` is the
 * shape application code actually wants when it needs *settings*, not
 * *secrets*: grouped by the subsystem that owns them (`app`, `database`,
 * `email`, `auth`, `payments`, `storage`, `sms`, `search`, `geocoding`,
 * `cache`, `queue`, `realtime`, `analytics`, `tracing`, `observability`,
 * `featureFlags`), with every field either a non-sensitive value (a URL,
 * an enum, a numeric knob) or a boolean *presence* flag for a field whose
 * actual value is a secret (e.g. `email.configured`, never
 * `email.apiKey`). No section here ever holds a credential, connection
 * string, or API key value — that is `SecretsProvider`
 * (`application/ports/secrets-provider.ts`)'s job, and deliberately a
 * separate port with a separate access pattern (presence checks and
 * masked description, not "read the value into a config object").
 *
 * `infrastructure/config/config-resolver.ts`'s `resolvePlatformConfig()`
 * is the single place an `Env` value is turned into this shape — a pure
 * function, exactly like `resolveTracingConfig()`
 * (`infrastructure/tracing/tracing-config.ts`) already is for tracing
 * alone. This module generalizes that one-off pattern into a
 * platform-wide, cached, typed accessor
 * (`application/services/config/config-service.ts`'s `ConfigService`),
 * instead of every module inventing its own `resolveXConfig()`.
 *
 * Deliberately depends on nothing outside `core/domain`, matching
 * `feature-flag.ts`'s own rule — no import of `Env`, no import from
 * infrastructure. The infrastructure layer is the seam where a real
 * `Env` value is read and mapped into this shape.
 */

/** Mirrors `env.NODE_ENV` — the codebase's one existing notion of
 *  "environment". No separate environment concept is introduced here,
 *  the same choice `feature-flag.ts`'s `FeatureFlagEnvironment` makes. */
export type PlatformEnvironment = "development" | "test" | "production";

export interface AppConfigSection {
  readonly url: string;
  readonly nodeEnv: PlatformEnvironment;
  readonly logLevel: "debug" | "info" | "warn" | "error";
}

export interface DatabaseConfigSection {
  readonly provider: "postgresql";
  /** Whether `DATABASE_URL` is set — never the connection string itself. */
  readonly configured: boolean;
}

export interface EmailConfigSection {
  readonly provider: "resend";
  /** `EMAIL_FROM` — a from-address, not a credential; safe to surface. */
  readonly from: string;
  /** Whether `RESEND_API_KEY` is set — never the key itself. */
  readonly configured: boolean;
}

export interface AuthConfigSection {
  readonly url: string;
  readonly trustHost: boolean;
  /** Which OAuth providers have both a client id and secret configured —
   *  provider *names* only (e.g. `["google"]`), never the credentials. */
  readonly configuredOAuthProviders: readonly string[];
}

export interface PaymentsConfigSection {
  readonly provider: "stripe";
  /** Whether Stripe Connect's client id is configured — that id is not
   *  itself a secret (it is meant to appear in an OAuth redirect URL),
   *  but its *presence* is still a meaningful operational setting. */
  readonly connectEnabled: boolean;
  /** Whether the three required Stripe credentials (secret key,
   *  publishable key, webhook secret) are all set. In production this is
   *  always `true` — `env.ts` requires them unconditionally — so this is
   *  primarily useful for local/dev/CI visibility. */
  readonly configured: boolean;
}

export interface StorageConfigSection {
  readonly provider: "cloudinary";
  /** `CLOUDINARY_CLOUD_NAME` — an account identifier, not a credential. */
  readonly cloudName: string;
  readonly configured: boolean;
}

export interface SmsConfigSection {
  readonly provider: "mock" | "twilio";
  /** For `provider: "mock"`, always `true` (nothing to configure). For
   *  `provider: "twilio"`, whether all three Twilio credentials are set. */
  readonly configured: boolean;
}

export interface SearchConfigSection {
  readonly provider: "none" | "meilisearch" | "typesense";
  readonly indexPrefix: string | null;
  readonly indexingEnabled: boolean;
  readonly batchSize: number;
}

export interface GeocodingConfigSection {
  readonly provider: "STATIC" | "MAPBOX" | "GOOGLE" | "HERE" | "OSM";
}

export interface CacheConfigSection {
  readonly keyPrefix: string | null;
  readonly bypassEnabled: boolean;
  /** Whether `REDIS_URL` is set — a single-instance deployment (unset)
   *  falls back to correct in-memory implementations everywhere. */
  readonly redisConfigured: boolean;
}

export interface QueueConfigSection {
  readonly eventQueueEnabled: boolean;
  readonly concurrency: number;
  readonly maxAttempts: number;
}

export interface RealtimeConfigSection {
  readonly heartbeatIntervalMs: number;
  readonly connectionTtlMs: number;
  readonly websocketEnabled: boolean;
  readonly websocketPort: number;
  readonly maxConnectionsPerUser: number;
}

export interface AnalyticsConfigSection {
  readonly refreshEnabled: boolean;
  readonly cacheTtlMs: number;
  readonly scheduledRefreshIntervalMs: number;
}

export interface TracingConfigSection {
  readonly enabled: boolean;
  readonly exporter: "console" | "otlp" | "none";
  readonly serviceName: string;
  readonly otlpEndpointConfigured: boolean;
}

export interface ObservabilityConfigSection {
  /** Whether `SENTRY_DSN` (server-side error reporting) is set. */
  readonly sentryConfigured: boolean;
  /** Whether `NEXT_PUBLIC_SENTRY_DSN` (client-side error reporting) is
   *  set. Not a secret — anything `NEXT_PUBLIC_*` is already inlined into
   *  the client bundle — but tracked here for the same operational-
   *  visibility reason as every other `*configured` flag. */
  readonly sentryClientConfigured: boolean;
  readonly sentryEnvironment: string | null;
  readonly tracesSampleRate: number | null;
}

export interface FeatureFlagsConfigSection {
  readonly enabled: boolean;
  /** Whether `FEATURE_FLAGS_CONFIG` (the operational override) is set —
   *  never its contents, which may include internal targeting rules. */
  readonly hasConfigOverride: boolean;
}

/**
 * The full structured configuration snapshot — every non-secret setting
 * an application module could want, grouped by subsystem. Built once per
 * process by `resolvePlatformConfig()` and cached by
 * `ConfigService`/`infrastructure/config/compose.ts`, exactly like every
 * other module's singleton `compose.ts` output — config cannot change
 * without a process restart in this codebase's existing conventions (no
 * env var is ever re-read mid-process), so there is nothing a
 * shorter-lived cache/TTL would buy here.
 */
export interface PlatformConfig {
  readonly app: AppConfigSection;
  readonly database: DatabaseConfigSection;
  readonly email: EmailConfigSection;
  readonly auth: AuthConfigSection;
  readonly payments: PaymentsConfigSection;
  readonly storage: StorageConfigSection;
  readonly sms: SmsConfigSection;
  readonly search: SearchConfigSection;
  readonly geocoding: GeocodingConfigSection;
  readonly cache: CacheConfigSection;
  readonly queue: QueueConfigSection;
  readonly realtime: RealtimeConfigSection;
  readonly analytics: AnalyticsConfigSection;
  readonly tracing: TracingConfigSection;
  readonly observability: ObservabilityConfigSection;
  readonly featureFlags: FeatureFlagsConfigSection;
}
