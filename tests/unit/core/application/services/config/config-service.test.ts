import { describe, expect, it } from "vitest";

import { ConfigService } from "@/application/services/config/config-service";
import type { SecretsProvider } from "@/application/ports/secrets-provider";
import type { PlatformConfig } from "@/domain/entities/platform-config";

const SAMPLE_CONFIG: PlatformConfig = {
  app: { url: "https://app.example.test", nodeEnv: "test", logLevel: "info" },
  database: { provider: "postgresql", configured: true },
  email: { provider: "resend", from: "MaestroYa <noreply@maestroya.test>", configured: true },
  auth: { url: "https://app.example.test", trustHost: true, configuredOAuthProviders: ["google"] },
  payments: { provider: "stripe", connectEnabled: false, configured: true },
  storage: { provider: "cloudinary", cloudName: "demo", configured: true },
  sms: { provider: "mock", configured: true },
  search: { provider: "none", indexPrefix: null, indexingEnabled: true, batchSize: 100 },
  geocoding: { provider: "STATIC" },
  cache: { keyPrefix: null, bypassEnabled: false, redisConfigured: false },
  queue: { eventQueueEnabled: false, concurrency: 5, maxAttempts: 3 },
  realtime: {
    heartbeatIntervalMs: 25_000,
    connectionTtlMs: 90_000,
    websocketEnabled: false,
    websocketPort: 3001,
    maxConnectionsPerUser: 10,
  },
  analytics: { refreshEnabled: true, cacheTtlMs: 300_000, scheduledRefreshIntervalMs: 900_000 },
  tracing: { enabled: false, exporter: "console", serviceName: "maestroya-platform", otlpEndpointConfigured: false },
  observability: {
    sentryConfigured: false,
    sentryClientConfigured: false,
    sentryEnvironment: null,
    tracesSampleRate: null,
  },
  featureFlags: { enabled: true, hasConfigOverride: false },
};

class FakeSecretsProvider implements SecretsProvider {
  constructor(private readonly values: Record<string, string | undefined>) {}

  getSecret(key: string): string | null {
    return this.values[key] ?? null;
  }

  hasSecret(key: string): boolean {
    return Boolean(this.values[key]);
  }

  listKnownKeys(): readonly string[] {
    return Object.keys(this.values);
  }
}

describe("application/services/config/config-service", () => {
  it("get(section) returns exactly the requested namespaced slice", () => {
    const service = new ConfigService(SAMPLE_CONFIG, new FakeSecretsProvider({}));

    expect(service.get("sms")).toEqual({ provider: "mock", configured: true });
    expect(service.get("tracing").exporter).toBe("console");
  });

  it("getAll() returns the full config object", () => {
    const service = new ConfigService(SAMPLE_CONFIG, new FakeSecretsProvider({}));
    expect(service.getAll()).toBe(SAMPLE_CONFIG);
  });

  it("hasSecret/getSecret delegate to the injected SecretsProvider", () => {
    const service = new ConfigService(
      SAMPLE_CONFIG,
      new FakeSecretsProvider({ AUTH_SECRET: "super-secret-value", DATABASE_URL: undefined }),
    );

    expect(service.hasSecret("AUTH_SECRET")).toBe(true);
    expect(service.getSecret("AUTH_SECRET")).toBe("super-secret-value");
    expect(service.hasSecret("DATABASE_URL")).toBe(false);
    expect(service.getSecret("DATABASE_URL")).toBeNull();
  });

  it("describeConfig() reports the full public config verbatim", () => {
    const service = new ConfigService(SAMPLE_CONFIG, new FakeSecretsProvider({}));
    const snapshot = service.describeConfig();

    expect(snapshot.environment).toBe("test");
    expect(snapshot.config).toEqual(SAMPLE_CONFIG);
  });

  it("describeConfig() masks every known secret to 'set'/'unset', never the value", () => {
    const service = new ConfigService(
      SAMPLE_CONFIG,
      new FakeSecretsProvider({
        AUTH_SECRET: "super-secret-value",
        STRIPE_SECRET_KEY: "sk_live_should_never_appear",
        DATABASE_URL: undefined,
      }),
    );

    const snapshot = service.describeConfig();

    expect(snapshot.secrets).toEqual({
      AUTH_SECRET: "set",
      STRIPE_SECRET_KEY: "set",
      DATABASE_URL: "unset",
    });
    // The actual secret values must never appear anywhere in the snapshot.
    expect(JSON.stringify(snapshot)).not.toContain("super-secret-value");
    expect(JSON.stringify(snapshot)).not.toContain("sk_live_should_never_appear");
  });

  it("describeConfig() covers every key SecretsProvider.listKnownKeys() reports, even with zero secrets set", () => {
    const service = new ConfigService(
      SAMPLE_CONFIG,
      new FakeSecretsProvider({ A: undefined, B: undefined, C: "set-value" }),
    );

    const snapshot = service.describeConfig();
    expect(Object.keys(snapshot.secrets).sort()).toEqual(["A", "B", "C"]);
    expect(snapshot.secrets.A).toBe("unset");
    expect(snapshot.secrets.C).toBe("set");
  });
});
