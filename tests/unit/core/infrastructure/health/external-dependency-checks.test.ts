import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

const ENV_KEYS = [...Object.keys(VALID_BASE_ENV), "SMS_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TRACING_ENABLED", "TRACING_EXPORTER", "OTEL_EXPORTER_OTLP_ENDPOINT", "STRIPE_CONNECT_CLIENT_ID"];

async function loadWith(overrides: Record<string, string | undefined>) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = mutableEnv[key];
  for (const key of ENV_KEYS) delete mutableEnv[key];
  const merged: Record<string, string | undefined> = { ...VALID_BASE_ENV, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  vi.resetModules();
  try {
    return await import("@/infrastructure/health/external-dependency-checks");
  } finally {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete mutableEnv[key];
      else mutableEnv[key] = original[key];
    }
  }
}

describe("infrastructure/health/external-dependency-checks", () => {
  afterEach(() => vi.resetModules());

  it("Stripe reports 'ok' when credentials are present", async () => {
    const mod = await loadWith({});
    expect(mod.collectStripeHealth().status).toBe("ok");
  });

  it("Cloudinary reports 'ok' when credentials are present", async () => {
    const mod = await loadWith({});
    expect(mod.collectCloudinaryHealth().status).toBe("ok");
  });

  it("Resend reports 'ok' when credentials are present", async () => {
    const mod = await loadWith({});
    expect(mod.collectResendHealth().status).toBe("ok");
  });

  it("Twilio reports 'disabled' when SMS_PROVIDER is mock (the default)", async () => {
    const mod = await loadWith({});
    expect(mod.collectTwilioHealth().status).toBe("disabled");
  });

  it("Twilio reports 'ok' when SMS_PROVIDER=twilio with full credentials", async () => {
    const mod = await loadWith({
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+15555555555",
    });
    expect(mod.collectTwilioHealth().status).toBe("ok");
  });

  it("Twilio reports 'degraded' when SMS_PROVIDER=twilio with incomplete credentials", async () => {
    const mod = await loadWith({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC123" });
    expect(mod.collectTwilioHealth().status).toBe("degraded");
  });

  it("OpenTelemetry reports 'disabled' when TRACING_ENABLED is unset (the default)", async () => {
    const mod = await loadWith({});
    expect(mod.collectOpenTelemetryCollectorHealth().status).toBe("disabled");
  });

  it("OpenTelemetry reports 'ok' when enabled with the console exporter", async () => {
    const mod = await loadWith({ TRACING_ENABLED: "true", TRACING_EXPORTER: "console" });
    expect(mod.collectOpenTelemetryCollectorHealth().status).toBe("ok");
  });

  it("OpenTelemetry reports 'degraded' when otlp is selected without an endpoint", async () => {
    const mod = await loadWith({ TRACING_ENABLED: "true", TRACING_EXPORTER: "otlp" });
    expect(mod.collectOpenTelemetryCollectorHealth().status).toBe("degraded");
  });
});
