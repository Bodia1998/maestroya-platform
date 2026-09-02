import { describe, expect, it, vi } from "vitest";

import { FraudTrustProviderError } from "@/domain/errors/domain-error";
import { TwilioLookupPhoneReputationProvider } from "@/infrastructure/trust-integrity/twilio-lookup-phone-reputation-provider";
import { logger } from "@/infrastructure/observability/logger";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const PHONE = "+34600123456";

describe("TwilioLookupPhoneReputationProvider (Module 93)", () => {
  it("returns a low-risk result for a valid mobile number", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { valid: true, country_code: "ES", line_type_intelligence: { type: "mobile", carrier_name: "Movistar" } }));
    const provider = new TwilioLookupPhoneReputationProvider({ accountSid: "AC1", authToken: "tok", fetchImpl, sleep: async () => {} });

    const result = await provider.lookup(PHONE);

    expect(result).toMatchObject({
      valid: true,
      lineType: "MOBILE",
      riskScore: 5,
      countryCode: "ES",
      carrierName: "Movistar",
      provider: "TWILIO_LOOKUP",
    });
  });

  it("scores a VOIP number as moderately risky", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { valid: true, country_code: "US", line_type_intelligence: { type: "voip", carrier_name: "Twilio" } }));
    const provider = new TwilioLookupPhoneReputationProvider({ accountSid: "AC1", authToken: "tok", fetchImpl, sleep: async () => {} });

    const result = await provider.lookup(PHONE);

    expect(result.lineType).toBe("VOIP");
    expect(result.riskScore).toBe(55);
  });

  it("treats a 404 (unassigned number) as invalid, not an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const provider = new TwilioLookupPhoneReputationProvider({ accountSid: "AC1", authToken: "tok", fetchImpl, sleep: async () => {} });

    const result = await provider.lookup(PHONE);

    expect(result).toMatchObject({ valid: false, lineType: "UNKNOWN", riskScore: 100 });
  });

  it("retries on a 5xx response and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { valid: true, country_code: "ES", line_type_intelligence: { type: "landline" } }));
    const provider = new TwilioLookupPhoneReputationProvider({
      accountSid: "AC1",
      authToken: "tok",
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    });

    const result = await provider.lookup(PHONE);

    expect(result.lineType).toBe("LANDLINE");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a non-404 4xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    const provider = new TwilioLookupPhoneReputationProvider({
      accountSid: "AC1",
      authToken: "bad",
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 3,
    });

    await expect(provider.lookup(PHONE)).rejects.toBeInstanceOf(FraudTrustProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("wraps a malformed response (missing `valid`) as a FraudTrustProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));
    const provider = new TwilioLookupPhoneReputationProvider({ accountSid: "AC1", authToken: "tok", fetchImpl, sleep: async () => {} });

    await expect(provider.lookup(PHONE)).rejects.toMatchObject({ code: "FRAUD_TRUST_PROVIDER_ERROR" });
  });

  it("never logs the full phone number — only a masked form reaches the logger", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { valid: true, line_type_intelligence: { type: "mobile" } }));
    const provider = new TwilioLookupPhoneReputationProvider({ accountSid: "AC1", authToken: "tok", fetchImpl, sleep: async () => {} });
    const infoSpy = vi.spyOn(logger, "info");

    await provider.lookup(PHONE);

    const loggedFields = infoSpy.mock.calls.map(([, fields]) => JSON.stringify(fields ?? {}));
    expect(loggedFields.some((f) => f.includes(PHONE))).toBe(false);
    expect(loggedFields.some((f) => f.includes("3456"))).toBe(true); // masked form keeps last 4

    infoSpy.mockRestore();
  });
});
