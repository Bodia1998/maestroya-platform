import type { PlatformConfig, PlatformEnvironment } from "@/domain/entities/platform-config";
import type { SecretPresence } from "@/application/services/config/config-service";
import { REQUIRED_SECRET_ENV_KEYS } from "@/infrastructure/config/config-resolver";

/**
 * Module 53 — Configuration & Secrets Management.
 *
 * The shape `/api/health/ready` reports under `checks.configuration`,
 * joining every other Module-4x/5x check there (`checks.cache`,
 * `checks.tracing`, `checks.analytics`, ...) in the route's established
 * **"operational visibility only"** category: reported, never allowed to
 * change the response's overall `status` or HTTP code.
 *
 * This check has an even weaker claim to load-bearing status than most of
 * its neighbours. A misconfigured *optional* provider (say, `SMS_PROVIDER
 * =twilio` selected with an incomplete credential set) does not mean this
 * instance can't serve traffic — it means one specific, already-isolated
 * feature (SMS delivery) degrades, and that feature's own health check
 * (`checks.smsProvider`, Module 49) already reports it. A *required*
 * secret being missing, the other thing this check looks for, cannot
 * actually happen at request-serving time in the first place — `env.ts`'s
 * `parseEnv()` throws at process startup before any request handler, this
 * route included, can ever run (see `REQUIRED_SECRET_ENV_KEYS`'s own doc
 * comment). `status: "degraded"` here is therefore always either (a) a
 * genuinely inert, informational signal about an optional provider's
 * incomplete setup, not a live incident, or (b) something that would have
 * prevented this very request from being served at all, making the
 * distinction moot. Neither case justifies a 503.
 *
 * Unlike `checks.tracing`/`checks.searchEngine`, this check has no
 * `"disabled"` state — configuration itself is never "off"; every
 * environment has one, always.
 */
export type ConfigHealthStatus = "ok" | "degraded";

export interface ConfigHealthReport {
  status: ConfigHealthStatus;
  environment: PlatformEnvironment;
  /** Whether every secret `envSchema` requires unconditionally
   *  (`REQUIRED_SECRET_ENV_KEYS`) is present. See this type's own doc
   *  comment for why this can, in practice, never be `false` by the time
   *  this check runs. */
  requiredSecretsConfigured: boolean;
  /** How many of the platform's swappable/optional providers (Redis,
   *  Sentry, each OAuth provider, a real geocoding/search backend, SMS's
   *  Twilio backend, Stripe Connect, OTLP tracing export) are actually
   *  configured right now — a quick "how much of the optional stack is
   *  lit up" signal for an operator glancing at this endpoint, without
   *  having to cross-reference half a dozen other `checks.*` entries. */
  configuredOptionalProviders: number;
  totalOptionalProviders: number;
  /** Specific, human-readable inconsistencies detected — e.g. a
   *  swappable provider selected without the credentials it needs to
   *  actually function. Empty when `status` is `"ok"`. */
  issues: string[];
}

export interface ConfigHealthInputs {
  config: PlatformConfig;
  secrets: Readonly<Record<string, SecretPresence>>;
}

/**
 * Collects the report. Pure and total — a health *check* must never
 * itself become an incident, mirroring `collectTracingHealth`/
 * `collectAnalyticsHealth`/`collectSearchEngineHealth` exactly.
 */
export function collectConfigHealth(inputs: ConfigHealthInputs): ConfigHealthReport {
  const { config, secrets } = inputs;
  const issues: string[] = [];

  const requiredSecretsConfigured = REQUIRED_SECRET_ENV_KEYS.every((key) => secrets[key] === "set");
  if (!requiredSecretsConfigured) {
    const missing = REQUIRED_SECRET_ENV_KEYS.filter((key) => secrets[key] !== "set");
    issues.push(`Required secret(s) not configured: ${missing.join(", ")}.`);
  }

  if (config.sms.provider === "twilio" && !config.sms.configured) {
    issues.push("SMS_PROVIDER=twilio is selected but Twilio credentials are incomplete.");
  }

  if (config.tracing.enabled && config.tracing.exporter === "otlp" && !config.tracing.otlpEndpointConfigured) {
    issues.push("TRACING_EXPORTER=otlp is selected but OTEL_EXPORTER_OTLP_ENDPOINT is not configured.");
  }

  const optionalProviderFlags = [
    config.cache.redisConfigured,
    config.observability.sentryConfigured,
    config.observability.sentryClientConfigured,
    config.auth.configuredOAuthProviders.includes("google"),
    config.auth.configuredOAuthProviders.includes("apple"),
    config.auth.configuredOAuthProviders.includes("facebook"),
    config.geocoding.provider !== "STATIC",
    config.search.provider !== "none",
    config.sms.provider === "twilio",
    config.payments.connectEnabled,
    config.tracing.enabled,
  ];

  return {
    status: issues.length === 0 ? "ok" : "degraded",
    environment: config.app.nodeEnv,
    requiredSecretsConfigured,
    configuredOptionalProviders: optionalProviderFlags.filter(Boolean).length,
    totalOptionalProviders: optionalProviderFlags.length,
    issues,
  };
}
