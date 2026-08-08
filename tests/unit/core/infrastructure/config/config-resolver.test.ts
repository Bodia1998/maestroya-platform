import { describe, expect, it } from "vitest";

import { resolvePlatformConfig, SECRET_ENV_KEYS, REQUIRED_SECRET_ENV_KEYS } from "@/infrastructure/config/config-resolver";
import { buildTestEnv } from "./platform-config-env-fixture";

describe("infrastructure/config/config-resolver", () => {
  it("maps app/database/email sections from the corresponding env fields", () => {
    const config = resolvePlatformConfig(buildTestEnv());

    expect(config.app).toEqual({ url: "https://app.example.test", nodeEnv: "test", logLevel: "info" });
    expect(config.database).toEqual({ provider: "postgresql", configured: true });
    expect(config.email).toEqual({
      provider: "resend",
      from: "MaestroYa <noreply@maestroya.test>",
      configured: true,
    });
  });

  it("auth.configuredOAuthProviders lists only providers with both a client id and secret set", () => {
    const noneConfigured = resolvePlatformConfig(buildTestEnv());
    expect(noneConfigured.auth.configuredOAuthProviders).toEqual([]);

    const googleOnly = resolvePlatformConfig(
      buildTestEnv({ AUTH_GOOGLE_ID: "gid", AUTH_GOOGLE_SECRET: "gsecret" }),
    );
    expect(googleOnly.auth.configuredOAuthProviders).toEqual(["google"]);

    const partial = resolvePlatformConfig(buildTestEnv({ AUTH_GOOGLE_ID: "gid" }));
    expect(partial.auth.configuredOAuthProviders).toEqual([]);

    const all = resolvePlatformConfig(
      buildTestEnv({
        AUTH_GOOGLE_ID: "gid",
        AUTH_GOOGLE_SECRET: "gsecret",
        AUTH_APPLE_ID: "aid",
        AUTH_APPLE_SECRET: "asecret",
        AUTH_FACEBOOK_ID: "fid",
        AUTH_FACEBOOK_SECRET: "fsecret",
      }),
    );
    expect(all.auth.configuredOAuthProviders).toEqual(["google", "apple", "facebook"]);
  });

  it("payments.connectEnabled reflects STRIPE_CONNECT_CLIENT_ID presence, independent of the base Stripe credentials", () => {
    expect(resolvePlatformConfig(buildTestEnv()).payments.connectEnabled).toBe(false);
    expect(
      resolvePlatformConfig(buildTestEnv({ STRIPE_CONNECT_CLIENT_ID: "ca_123" })).payments.connectEnabled,
    ).toBe(true);
  });

  it("sms.configured is always true for the mock provider, and reflects credential completeness for twilio", () => {
    expect(resolvePlatformConfig(buildTestEnv({ SMS_PROVIDER: "mock" })).sms.configured).toBe(true);

    const incompleteTwilio = resolvePlatformConfig(
      buildTestEnv({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "sid" }),
    );
    expect(incompleteTwilio.sms.configured).toBe(false);

    const completeTwilio = resolvePlatformConfig(
      buildTestEnv({
        SMS_PROVIDER: "twilio",
        TWILIO_ACCOUNT_SID: "sid",
        TWILIO_AUTH_TOKEN: "token",
        TWILIO_FROM_NUMBER: "+15550000000",
      }),
    );
    expect(completeTwilio.sms.configured).toBe(true);
  });

  it("search.indexingEnabled defaults to true (SEARCH_INDEXING_ENABLED unset) and honors an explicit 'false'", () => {
    expect(resolvePlatformConfig(buildTestEnv()).search.indexingEnabled).toBe(true);
    expect(
      resolvePlatformConfig(buildTestEnv({ SEARCH_INDEXING_ENABLED: "false" })).search.indexingEnabled,
    ).toBe(false);
  });

  it("analytics.refreshEnabled defaults to true (opt-out) and honors an explicit 'false'", () => {
    expect(resolvePlatformConfig(buildTestEnv()).analytics.refreshEnabled).toBe(true);
    expect(
      resolvePlatformConfig(buildTestEnv({ ANALYTICS_REFRESH_ENABLED: "false" })).analytics.refreshEnabled,
    ).toBe(false);
  });

  it("tracing.enabled/queue.eventQueueEnabled/cache.bypassEnabled default to false (opt-in) when unset", () => {
    const config = resolvePlatformConfig(buildTestEnv());
    expect(config.tracing.enabled).toBe(false);
    expect(config.queue.eventQueueEnabled).toBe(false);
    expect(config.cache.bypassEnabled).toBe(false);
  });

  it("tracing.serviceName falls back to the platform default when OTEL_SERVICE_NAME is unset", () => {
    expect(resolvePlatformConfig(buildTestEnv()).tracing.serviceName).toBe("maestroya-platform");
    expect(
      resolvePlatformConfig(buildTestEnv({ OTEL_SERVICE_NAME: "custom-name" })).tracing.serviceName,
    ).toBe("custom-name");
  });

  it("cache.redisConfigured and observability.sentryConfigured reflect secret presence, not their value", () => {
    expect(resolvePlatformConfig(buildTestEnv()).cache.redisConfigured).toBe(false);
    expect(
      resolvePlatformConfig(buildTestEnv({ REDIS_URL: "redis://localhost:6379" })).cache.redisConfigured,
    ).toBe(true);

    expect(resolvePlatformConfig(buildTestEnv()).observability.sentryConfigured).toBe(false);
    expect(
      resolvePlatformConfig(buildTestEnv({ SENTRY_DSN: "https://key@sentry.example.test/1" })).observability
        .sentryConfigured,
    ).toBe(true);
  });

  it("featureFlags section reflects FEATURE_FLAGS_ENABLED and whether an override is configured", () => {
    const config = resolvePlatformConfig(buildTestEnv({ FEATURE_FLAGS_CONFIG: "[]" }));
    expect(config.featureFlags).toEqual({ enabled: true, hasConfigOverride: true });
  });

  it("never throws for a minimal, fully-unset-optional-fields env", () => {
    expect(() => resolvePlatformConfig(buildTestEnv())).not.toThrow();
  });

  it("SECRET_ENV_KEYS and REQUIRED_SECRET_ENV_KEYS never contain duplicates, and required is a subset of the full list", () => {
    expect(new Set(SECRET_ENV_KEYS).size).toBe(SECRET_ENV_KEYS.length);
    expect(new Set(REQUIRED_SECRET_ENV_KEYS).size).toBe(REQUIRED_SECRET_ENV_KEYS.length);
    for (const key of REQUIRED_SECRET_ENV_KEYS) {
      expect(SECRET_ENV_KEYS).toContain(key);
    }
  });
});
