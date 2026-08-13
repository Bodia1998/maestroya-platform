import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PersonaVerificationProvider } from "@/infrastructure/verification/persona-verification-provider";
import type { PersonaClient } from "@/infrastructure/verification/persona-client";

function fakeClient(handler: (req: { method: string; path: string; body?: unknown }) => unknown): PersonaClient {
  return { request: vi.fn(async (req) => handler(req)) } as unknown as PersonaClient;
}

describe("PersonaVerificationProvider (Module 59)", () => {
  it("createVerification returns a hosted link and the mapped outcome", async () => {
    const client = fakeClient(() => ({
      data: { id: "inq_abc", type: "inquiry", attributes: { status: "created" } },
      meta: { "one-time-link": "https://withpersona.com/verify/abc" },
    }));
    const provider = new PersonaVerificationProvider({ client, templateId: "tmpl_1" });

    const result = await provider.createVerification({
      verificationId: "case-1",
      fullName: "Ana García López",
      countryCode: "ES",
    });

    expect(result.providerVerificationId).toBe("inq_abc");
    expect(result.verificationUrl).toBe("https://withpersona.com/verify/abc");
    expect(result.outcome).toBe("PENDING");
  });

  it("createVerification throws when Persona returns no hosted link", async () => {
    const client = fakeClient(() => ({
      data: { id: "inq_abc", type: "inquiry", attributes: { status: "created" } },
      meta: {},
    }));
    const provider = new PersonaVerificationProvider({ client, templateId: "tmpl_1" });

    await expect(
      provider.createVerification({ verificationId: "case-1", fullName: "Ana García", countryCode: "ES" }),
    ).rejects.toMatchObject({ code: "VERIFICATION_PROVIDER_ERROR" });
  });

  it("getVerification maps a completed inquiry to VERIFIED", async () => {
    const client = fakeClient(() => ({
      data: { id: "inq_abc", type: "inquiry", attributes: { status: "completed" } },
    }));
    const provider = new PersonaVerificationProvider({ client, templateId: "tmpl_1" });

    const result = await provider.getVerification("inq_abc");

    expect(result.outcome).toBe("VERIFIED");
    expect(result.rawStatus).toBe("completed");
  });

  it("maps failed/declined to REJECTED, needs_review to NEEDS_REVIEW, expired to EXPIRED, unknown to IN_PROGRESS", async () => {
    const cases: [string, string][] = [
      ["failed", "REJECTED"],
      ["declined", "REJECTED"],
      ["needs_review", "NEEDS_REVIEW"],
      ["expired", "EXPIRED"],
      ["some-future-status", "IN_PROGRESS"],
    ];

    for (const [rawStatus, expectedOutcome] of cases) {
      const client = fakeClient(() => ({
        data: { id: "inq_x", type: "inquiry", attributes: { status: rawStatus } },
      }));
      const provider = new PersonaVerificationProvider({ client, templateId: "tmpl_1" });
      const result = await provider.getVerification("inq_x");
      expect(result.outcome).toBe(expectedOutcome);
    }
  });

  it("refreshStatus delegates to getVerification", async () => {
    const client = fakeClient(() => ({
      data: { id: "inq_abc", type: "inquiry", attributes: { status: "pending" } },
    }));
    const provider = new PersonaVerificationProvider({ client, templateId: "tmpl_1" });

    const result = await provider.refreshStatus("inq_abc");
    expect(result.outcome).toBe("PENDING");
  });

  describe("webhookValidation", () => {
    const secret = "whsec_test";

    function sign(body: string, timestamp: string) {
      return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    }

    it("rejects when no webhook secret is configured", () => {
      const provider = new PersonaVerificationProvider({ client: fakeClient(() => ({})), templateId: "tmpl_1" });
      expect(provider.webhookValidation("{}", "t=1,v1=abc").valid).toBe(false);
    });

    it("rejects when the signature header is missing", () => {
      const provider = new PersonaVerificationProvider({ client: fakeClient(() => ({})), templateId: "tmpl_1", webhookSecret: secret });
      expect(provider.webhookValidation("{}", null).valid).toBe(false);
    });

    it("rejects a tampered payload", () => {
      const provider = new PersonaVerificationProvider({ client: fakeClient(() => ({})), templateId: "tmpl_1", webhookSecret: secret });
      const body = JSON.stringify({ data: { attributes: {} } });
      const timestamp = "1700000000";
      const signature = sign(body, timestamp);

      const result = provider.webhookValidation(body + "tampered", `t=${timestamp},v1=${signature}`);
      expect(result.valid).toBe(false);
    });

    it("accepts a validly signed payload and parses the outcome", () => {
      const provider = new PersonaVerificationProvider({ client: fakeClient(() => ({})), templateId: "tmpl_1", webhookSecret: secret });
      const inner = { data: { id: "inq_abc", type: "inquiry", attributes: { status: "completed" } } };
      const body = JSON.stringify({ data: { attributes: { payload: inner } } });
      const timestamp = "1700000000";
      const signature = sign(body, timestamp);

      const result = provider.webhookValidation(body, `t=${timestamp},v1=${signature}`);

      expect(result.valid).toBe(true);
      expect(result.providerVerificationId).toBe("inq_abc");
      expect(result.outcome).toBe("VERIFIED");
      expect(result.rawStatus).toBe("completed");
    });
  });
});
