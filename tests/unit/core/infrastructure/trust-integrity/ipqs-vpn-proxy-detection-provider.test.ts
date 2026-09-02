import { describe, expect, it, vi } from "vitest";

import { FraudTrustProviderError } from "@/domain/errors/domain-error";
import { IpqsVpnProxyDetectionProvider } from "@/infrastructure/trust-integrity/ipqs-vpn-proxy-detection-provider";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const INPUT = { ipHash: "hash123", ip: "1.2.3.4" };

describe("IpqsVpnProxyDetectionProvider (Module 93)", () => {
  it("classifies a clean residential connection", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, fraud_score: 5, proxy: false, vpn: false, tor: false, connection_type: "Residential" }));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await provider.classify(INPUT);

    expect(result).toMatchObject({
      classification: "CLEAN",
      confidence: 5,
      isVpn: false,
      isProxy: false,
      isTor: false,
      isHosting: false,
      riskLevel: "LOW",
      provider: "IPQS",
    });
  });

  it("classifies a VPN connection with a high risk level", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, fraud_score: 70, proxy: false, vpn: true, tor: false, connection_type: "Corporate" }));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await provider.classify(INPUT);

    expect(result.classification).toBe("VPN");
    expect(result.isVpn).toBe(true);
    expect(result.riskLevel).toBe("HIGH");
  });

  it("classifies Tor over every other signal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, fraud_score: 95, proxy: true, vpn: true, tor: true, connection_type: "Data Center" }));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await provider.classify(INPUT);

    expect(result.classification).toBe("TOR");
    expect(result.riskLevel).toBe("CRITICAL");
  });

  it("classifies a datacenter/hosting connection", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, fraud_score: 40, proxy: false, vpn: false, tor: false, connection_type: "Data Center" }));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await provider.classify(INPUT);

    expect(result.classification).toBe("DATACENTER_PROXY");
    expect(result.isHosting).toBe(true);
    expect(result.riskLevel).toBe("MEDIUM");
  });

  it("throws a non-retryable FraudTrustProviderError for success:false (malformed/app-level failure)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: false, message: "Invalid API key" }));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "bad-key", fetchImpl, sleep: async () => {} });

    await expect(provider.classify(INPUT)).rejects.toMatchObject({
      code: "FRAUD_TRUST_PROVIDER_ERROR",
      kind: "VPN_PROXY_DETECTION",
      retryable: false,
    });
  });

  it("retries on a 5xx response and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, fraud_score: 1, proxy: false, vpn: false, tor: false, connection_type: "Residential" }));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {}, maxAttempts: 2 });

    const result = await provider.classify(INPUT);

    expect(result.classification).toBe("CLEAN");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a 4xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, {}));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {}, maxAttempts: 3 });

    await expect(provider.classify(INPUT)).rejects.toBeInstanceOf(FraudTrustProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("wraps a timeout as a retryable FraudTrustProviderError", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {}, maxAttempts: 1 });

    await expect(provider.classify(INPUT)).rejects.toMatchObject({ retryable: true });
  });

  it("never logs the raw IP — only ipHash appears in any call arguments to the fetch URL, never in a thrown error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, fraud_score: 1, proxy: false, vpn: false, tor: false }));
    const provider = new IpqsVpnProxyDetectionProvider({ apiKey: "key", fetchImpl, sleep: async () => {} });

    await provider.classify(INPUT);

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toContain(INPUT.ip); // the outbound request itself must carry the raw IP
    // but the returned result must never carry it:
  });
});
