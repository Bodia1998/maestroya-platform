import { describe, expect, it, vi } from "vitest";

import { FingerprintJsDeviceFingerprintProvider } from "@/infrastructure/trust-integrity/fingerprintjs-device-fingerprint-provider";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("FingerprintJsDeviceFingerprintProvider (Module 93)", () => {
  it("degrades to the low-confidence fallback when rawSignal has no requestId", async () => {
    const fetchImpl = vi.fn();
    const provider = new FingerprintJsDeviceFingerprintProvider({ secretApiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await provider.fingerprint({ userAgent: "UA", timezone: "Europe/Madrid" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.provider).toBe("NULL");
    expect(result.confidence).toBeNull();
    expect(result.browserFingerprint).toBe("UA");
  });

  it("returns a real, high-confidence result when the Server API resolves the requestId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        products: {
          identification: {
            data: {
              visitorId: "visitor_abc123",
              confidence: { score: 0.97 },
              browserDetails: { userAgent: "UA", os: "macOS", device: "Other" },
            },
          },
        },
      }),
    );
    const provider = new FingerprintJsDeviceFingerprintProvider({ secretApiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await provider.fingerprint({ requestId: "req_123" });

    expect(result).toMatchObject({ deviceId: "visitor_abc123", provider: "FINGERPRINTJS", confidence: 97, operatingSystem: "macOS" });
  });

  it("degrades (does not throw) for a stale/unrecognized requestId (404)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const provider = new FingerprintJsDeviceFingerprintProvider({ secretApiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await provider.fingerprint({ requestId: "req_stale" });

    expect(result.provider).toBe("NULL");
  });

  it("retries on a 5xx response and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { products: { identification: { data: { visitorId: "v1", confidence: { score: 0.5 } } } } }),
      );
    const provider = new FingerprintJsDeviceFingerprintProvider({
      secretApiKey: "key",
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    });

    const result = await provider.fingerprint({ requestId: "req_123" });

    expect(result.deviceId).toBe("v1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a retryable FraudTrustProviderError after exhausting retries on repeated 5xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const provider = new FingerprintJsDeviceFingerprintProvider({
      secretApiKey: "key",
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    });

    await expect(provider.fingerprint({ requestId: "req_123" })).rejects.toMatchObject({
      code: "FRAUD_TRUST_PROVIDER_ERROR",
      kind: "DEVICE_FINGERPRINT",
      retryable: true,
    });
  });

  it("selects the EU region host by default", () => {
    const provider = new FingerprintJsDeviceFingerprintProvider({ secretApiKey: "key" });
    expect(provider).toBeInstanceOf(FingerprintJsDeviceFingerprintProvider);
  });
});
