import { describe, expect, it } from "vitest";

import { collectConfigHealth } from "@/infrastructure/config/config-health";
import { resolvePlatformConfig, REQUIRED_SECRET_ENV_KEYS } from "@/infrastructure/config/config-resolver";
import { EnvSecretsProvider } from "@/infrastructure/config/env-secrets-provider";
import { ConfigService } from "@/application/services/config/config-service";
import { buildTestEnv } from "./platform-config-env-fixture";

function healthFor(env: ReturnType<typeof buildTestEnv>) {
  const service = new ConfigService(resolvePlatformConfig(env), new EnvSecretsProvider(env));
  const { config, secrets } = service.describeConfig();
  return collectConfigHealth({ config, secrets });
}

describe("infrastructure/config/config-health", () => {
  it("reports 'ok' with no issues for a fully-valid baseline env", () => {
    const report = healthFor(buildTestEnv());

    expect(report.status).toBe("ok");
    expect(report.issues).toEqual([]);
    expect(report.requiredSecretsConfigured).toBe(true);
    expect(report.environment).toBe("test");
  });

  it("flags SMS_PROVIDER=twilio with incomplete credentials as a degraded issue", () => {
    const report = healthFor(buildTestEnv({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "sid" }));

    expect(report.status).toBe("degraded");
    expect(report.issues).toEqual([
      "SMS_PROVIDER=twilio is selected but Twilio credentials are incomplete.",
    ]);
  });

  it("does not flag SMS_PROVIDER=twilio when all three credentials are present", () => {
    const report = healthFor(
      buildTestEnv({
        SMS_PROVIDER: "twilio",
        TWILIO_ACCOUNT_SID: "sid",
        TWILIO_AUTH_TOKEN: "token",
        TWILIO_FROM_NUMBER: "+15550000000",
      }),
    );

    expect(report.status).toBe("ok");
    expect(report.issues).toEqual([]);
  });

  it("flags TRACING_EXPORTER=otlp enabled without an endpoint as a degraded issue", () => {
    const report = healthFor(buildTestEnv({ TRACING_ENABLED: "true", TRACING_EXPORTER: "otlp" }));

    expect(report.status).toBe("degraded");
    expect(report.issues).toEqual([
      "TRACING_EXPORTER=otlp is selected but OTEL_EXPORTER_OTLP_ENDPOINT is not configured.",
    ]);
  });

  it("does not flag TRACING_EXPORTER=otlp when tracing is disabled, even without an endpoint", () => {
    const report = healthFor(buildTestEnv({ TRACING_ENABLED: "false", TRACING_EXPORTER: "otlp" }));
    expect(report.status).toBe("ok");
  });

  it("does not flag TRACING_EXPORTER=otlp when the endpoint is configured", () => {
    const report = healthFor(
      buildTestEnv({
        TRACING_ENABLED: "true",
        TRACING_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
      }),
    );
    expect(report.status).toBe("ok");
  });

  it("accumulates multiple simultaneous issues", () => {
    const report = healthFor(
      buildTestEnv({
        SMS_PROVIDER: "twilio",
        TRACING_ENABLED: "true",
        TRACING_EXPORTER: "otlp",
      }),
    );

    expect(report.status).toBe("degraded");
    expect(report.issues).toHaveLength(2);
  });

  it("requiredSecretsConfigured is false and an issue is reported when a required secret is missing from the provider", () => {
    const config = resolvePlatformConfig(buildTestEnv());
    const secrets: Record<string, "set" | "unset"> = {};
    for (const key of REQUIRED_SECRET_ENV_KEYS) secrets[key] = "set";
    secrets.AUTH_SECRET = "unset";

    const report = collectConfigHealth({ config, secrets });

    expect(report.requiredSecretsConfigured).toBe(false);
    expect(report.status).toBe("degraded");
    expect(report.issues[0]).toContain("AUTH_SECRET");
  });

  it("counts configured optional providers without exceeding the total", () => {
    const baseline = healthFor(buildTestEnv());
    const enriched = healthFor(
      buildTestEnv({
        REDIS_URL: "redis://localhost:6379",
        SENTRY_DSN: "https://key@sentry.example.test/1",
        GEOCODING_PROVIDER: "OSM",
      }),
    );

    expect(enriched.configuredOptionalProviders).toBeGreaterThan(baseline.configuredOptionalProviders);
    expect(enriched.configuredOptionalProviders).toBeLessThanOrEqual(enriched.totalOptionalProviders);
    expect(baseline.totalOptionalProviders).toBe(enriched.totalOptionalProviders);
  });

  it("never throws for any combination of inputs", () => {
    expect(() => healthFor(buildTestEnv({ SMS_PROVIDER: "twilio", TRACING_ENABLED: "true" }))).not.toThrow();
  });
});
