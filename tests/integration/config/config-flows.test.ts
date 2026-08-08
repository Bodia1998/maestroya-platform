import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../../unit/core/infrastructure/config/env-fixture";

/**
 * Module 53 — Configuration & Secrets Management: end-to-end wiring/
 * composition coverage.
 *
 * Unlike the unit tests (`config-resolver.test.ts`, `env-secrets-provider.test.ts`,
 * `config-service.test.ts`, `config-health.test.ts`, which exercise pure
 * functions and hand-built fakes), this suite imports the real
 * composition root (`infrastructure/config/compose.ts`) under a
 * controlled `process.env`, the same `vi.resetModules()` + re-import
 * pattern `tests/integration/feature-flags/feature-flag-flows.test.ts`
 * uses — proving real env vars actually reach the real `ConfigService`/
 * `EnvSecretsProvider` instances the rest of the app would get via
 * `getConfigService()`/`getSecretsProvider()`.
 */
async function loadConfigModule(overrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  mutableEnv.NODE_ENV = "test";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  return import("@/infrastructure/config/compose");
}

describe("Module 53 — Configuration & Secrets Management — composition wiring", () => {
  afterEach(() => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    for (const key of [
      "REDIS_URL",
      "SENTRY_DSN",
      "SMS_PROVIDER",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
      "TRACING_ENABLED",
      "TRACING_EXPORTER",
      "NODE_ENV",
    ]) {
      delete mutableEnv[key];
    }
    vi.resetModules();
  });

  it("getConfigService().get(section) reflects real env values end-to-end", async () => {
    const { getConfigService } = await loadConfigModule({ REDIS_URL: "redis://localhost:6379" });

    expect(getConfigService().get("cache").redisConfigured).toBe(true);
    expect(getConfigService().get("app").nodeEnv).toBe("test");
  });

  it("getSecretsProvider() reports the real Stripe/Auth secrets as configured, since VALID_BASE_ENV always sets them", async () => {
    const { getSecretsProvider } = await loadConfigModule();

    expect(getSecretsProvider().hasSecret("AUTH_SECRET")).toBe(true);
    expect(getSecretsProvider().hasSecret("STRIPE_SECRET_KEY")).toBe(true);
    expect(getSecretsProvider().hasSecret("REDIS_URL")).toBe(false);
  });

  it("describeConfig() never leaks a real secret value, even when several are configured", async () => {
    const { getConfigService } = await loadConfigModule({
      REDIS_URL: "redis://:supersecretpassword@localhost:6379",
      SENTRY_DSN: "https://public@o12345.ingest.sentry.io/67890",
    });

    const snapshot = getConfigService().describeConfig();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.secrets.REDIS_URL).toBe("set");
    expect(snapshot.secrets.SENTRY_DSN).toBe("set");
    expect(serialized).not.toContain("supersecretpassword");
    expect(serialized).not.toContain(VALID_BASE_ENV.STRIPE_SECRET_KEY);
    expect(serialized).not.toContain(VALID_BASE_ENV.AUTH_SECRET);
  });

  it("getConfigHealth() reflects a real misconfiguration end-to-end (SMS_PROVIDER=twilio with no credentials)", async () => {
    const { getConfigHealth } = await loadConfigModule({ SMS_PROVIDER: "twilio" });

    const health = getConfigHealth();
    expect(health.status).toBe("degraded");
    expect(health.issues.some((issue) => issue.includes("SMS_PROVIDER"))).toBe(true);
  });

  it("getConfigHealth() reports 'ok' for the process's normal, unmodified baseline configuration", async () => {
    const { getConfigHealth } = await loadConfigModule();
    expect(getConfigHealth().status).toBe("ok");
  });

  it("/api/health/ready exposes checks.configuration with the same shape getConfigHealth() returns, without affecting overall readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    const mutableEnv = process.env as Record<string, string | undefined>;
    for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
    mutableEnv.NODE_ENV = "test";
    mutableEnv.SMS_PROVIDER = "twilio";
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/ready"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.configuration.status).toBe("degraded");
    expect(body.checks.configuration.environment).toBe("test");

    vi.doUnmock("@/infrastructure/database/prisma/client");
    delete mutableEnv.SMS_PROVIDER;
    vi.resetModules();
  });
});
