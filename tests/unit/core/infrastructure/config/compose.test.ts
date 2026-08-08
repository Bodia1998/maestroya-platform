import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "./env-fixture";

async function loadCompose(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  mutableEnv.NODE_ENV = "test";
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  vi.resetModules();
  return import("@/infrastructure/config/compose");
}

describe("infrastructure/config/compose", () => {
  afterEach(() => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    delete mutableEnv.REDIS_URL;
    delete mutableEnv.SMS_PROVIDER;
    delete mutableEnv.TWILIO_ACCOUNT_SID;
    delete mutableEnv.TWILIO_AUTH_TOKEN;
    delete mutableEnv.TWILIO_FROM_NUMBER;
    delete mutableEnv.NODE_ENV;
    vi.resetModules();
  });

  it("getConfigService() returns the same singleton instance on repeated calls", async () => {
    const { getConfigService } = await loadCompose();
    const first = getConfigService();
    const second = getConfigService();
    expect(first).toBe(second);
  });

  it("getSecretsProvider() returns the same singleton instance on repeated calls", async () => {
    const { getSecretsProvider } = await loadCompose();
    expect(getSecretsProvider()).toBe(getSecretsProvider());
  });

  it("getConfigService() is built from the real env — reflects the process's actual configuration", async () => {
    const { getConfigService } = await loadCompose({ REDIS_URL: "redis://localhost:6379" });
    expect(getConfigService().get("cache").redisConfigured).toBe(true);
  });

  it("getConfigHealth() reports 'ok' for a valid baseline configuration", async () => {
    const { getConfigHealth } = await loadCompose();
    const health = getConfigHealth();
    expect(health.status).toBe("ok");
    expect(health.environment).toBe("test");
  });

  it("getConfigHealth() reports 'degraded' when an optional provider is selected but misconfigured", async () => {
    const { getConfigHealth } = await loadCompose({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "sid" });
    const health = getConfigHealth();
    expect(health.status).toBe("degraded");
    expect(health.issues.length).toBeGreaterThan(0);
  });

  it("__testing.reset() forces the next getConfigService()/getSecretsProvider() call to rebuild", async () => {
    const { getConfigService, getSecretsProvider, __testing } = await loadCompose();
    const before = getConfigService();
    const beforeSecrets = getSecretsProvider();

    __testing.reset();

    expect(getConfigService()).not.toBe(before);
    expect(getSecretsProvider()).not.toBe(beforeSecrets);
  });
});
