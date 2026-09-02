import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 93 — Real Fraud & Trust Signal Providers. Mirrors
 * `verification-provider-factory.test.ts`'s own `vi.doMock` pattern.
 */
async function loadFactory(envOverrides: Record<string, unknown>) {
  vi.doMock("@/infrastructure/config/env", () => ({ env: envOverrides }));
  vi.resetModules();
  return import("@/infrastructure/trust-integrity/trust-integrity-provider-factory");
}

describe("trust-integrity-provider-factory (Module 93)", () => {
  afterEach(() => {
    vi.doUnmock("@/infrastructure/config/env");
    vi.resetModules();
  });

  it("resolves to the Null device-fingerprint provider by default", async () => {
    const { createDeviceFingerprintProvider } = await loadFactory({ FRAUD_DEVICE_FINGERPRINT_PROVIDER: "null" });
    expect(createDeviceFingerprintProvider().name).toBe("NULL");
  });

  it("falls back to the Null device-fingerprint provider when fingerprintjs is selected without credentials", async () => {
    const { createDeviceFingerprintProvider } = await loadFactory({
      FRAUD_DEVICE_FINGERPRINT_PROVIDER: "fingerprintjs",
      FINGERPRINTJS_SECRET_API_KEY: undefined,
    });
    expect(createDeviceFingerprintProvider().name).toBe("NULL");
  });

  it("constructs the real FingerprintJS provider once selected and configured", async () => {
    const { createDeviceFingerprintProvider } = await loadFactory({
      FRAUD_DEVICE_FINGERPRINT_PROVIDER: "fingerprintjs",
      FINGERPRINTJS_SECRET_API_KEY: "key",
      FINGERPRINTJS_REGION: "eu",
      FINGERPRINTJS_TIMEOUT_MS: 5000,
    });
    expect(createDeviceFingerprintProvider().name).toBe("FINGERPRINTJS");
  });

  it("resolves to the Null VPN/proxy provider by default", async () => {
    const { createVpnProxyDetectionProvider } = await loadFactory({ FRAUD_VPN_PROXY_PROVIDER: "null" });
    expect(createVpnProxyDetectionProvider().name).toBe("NULL");
  });

  it("falls back to the Null VPN/proxy provider when ipqs is selected without a key", async () => {
    const { createVpnProxyDetectionProvider } = await loadFactory({ FRAUD_VPN_PROXY_PROVIDER: "ipqs", IPQS_API_KEY: undefined });
    expect(createVpnProxyDetectionProvider().name).toBe("NULL");
  });

  it("constructs the real IPQS provider once selected and configured", async () => {
    const { createVpnProxyDetectionProvider } = await loadFactory({
      FRAUD_VPN_PROXY_PROVIDER: "ipqs",
      IPQS_API_KEY: "key",
      IPQS_TIMEOUT_MS: 4000,
    });
    expect(createVpnProxyDetectionProvider().name).toBe("IPQS");
  });

  it("resolves to the Null phone-reputation provider by default", async () => {
    const { createPhoneReputationProvider } = await loadFactory({ FRAUD_PHONE_REPUTATION_PROVIDER: "null" });
    expect(createPhoneReputationProvider().name).toBe("NULL");
  });

  it("falls back to the Null phone-reputation provider when twilio_lookup is selected without credentials", async () => {
    const { createPhoneReputationProvider } = await loadFactory({
      FRAUD_PHONE_REPUTATION_PROVIDER: "twilio_lookup",
      TWILIO_ACCOUNT_SID: undefined,
      TWILIO_AUTH_TOKEN: undefined,
    });
    expect(createPhoneReputationProvider().name).toBe("NULL");
  });

  it("constructs the real Twilio Lookup provider once selected and configured", async () => {
    const { createPhoneReputationProvider } = await loadFactory({
      FRAUD_PHONE_REPUTATION_PROVIDER: "twilio_lookup",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_LOOKUP_TIMEOUT_MS: 5000,
    });
    expect(createPhoneReputationProvider().name).toBe("TWILIO_LOOKUP");
  });

  it("memoizes each provider until __testing.reset()", async () => {
    const { createVpnProxyDetectionProvider, __testing } = await loadFactory({ FRAUD_VPN_PROXY_PROVIDER: "null" });
    const first = createVpnProxyDetectionProvider();
    const second = createVpnProxyDetectionProvider();
    expect(first).toBe(second);

    __testing.reset();
    expect(createVpnProxyDetectionProvider()).not.toBe(first);
  });
});
