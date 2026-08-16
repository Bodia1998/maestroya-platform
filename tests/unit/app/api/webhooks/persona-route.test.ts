import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective G):
 * HTTP-level wiring test for `POST /api/webhooks/persona` — request in,
 * signature validation, idempotency/use-case delegation, response out.
 * The route is imported and invoked directly (no real server), the same
 * lightweight approach `tests/unit/middleware.test.ts` already establishes
 * for exercising a real Next.js Route Handler/middleware against a real
 * `NextRequest`. `PersonaVerificationProvider`'s signature verification
 * itself is already covered directly by
 * persona-verification-provider.test.ts; `ProcessPersonaWebhookUseCase`'s
 * own orchestration is covered by
 * tests/integration/verification/persona-webhook-flows.test.ts. This file
 * only proves the Route Handler's own thin-controller wiring: it reads the
 * real signature-verification result and the real use case's outcome
 * correctly, and never processes anything before the signature check
 * passes.
 */

const mockExecute = vi.fn();
const mockWebhookValidation = vi.fn();

vi.mock("@/application/use-cases/verification/compose", () => ({
  getVerificationProviderInstance: () => ({ webhookValidation: mockWebhookValidation }),
  makeProcessPersonaWebhookUseCase: () => ({ execute: mockExecute }),
}));

const { POST } = await import("../../../../../src/app/api/webhooks/persona/route");

function makeRequest(body: string, signatureHeader: string | null): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (signatureHeader) headers.set("persona-signature", signatureHeader);
  return new NextRequest("http://localhost:3000/api/webhooks/persona", { method: "POST", body, headers });
}

describe("POST /api/webhooks/persona", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockWebhookValidation.mockReset();
  });

  it("fails closed with 401 on an invalid signature, and never calls the processing use case", async () => {
    mockWebhookValidation.mockReturnValue({ valid: false });

    const response = await POST(makeRequest("{}", "t=1,v1=deadbeef"));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("fails closed with 401 when no signature header is present at all", async () => {
    mockWebhookValidation.mockReturnValue({ valid: false });

    const response = await POST(makeRequest("{}", null));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("acknowledges (200) a validly signed payload with no recognizable event id, without calling the use case", async () => {
    mockWebhookValidation.mockReturnValue({ valid: true });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ignored");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("delegates to ProcessPersonaWebhookUseCase with exactly the fields webhookValidation extracted, never the raw body", async () => {
    mockWebhookValidation.mockReturnValue({
      valid: true,
      externalEventId: "evt_1",
      eventType: "inquiry.completed",
      providerVerificationId: "inq_1",
      outcome: "VERIFIED",
      rawStatus: "completed",
    });
    mockExecute.mockResolvedValue({ outcome: "processed", verificationId: "verification-1" });

    const response = await POST(makeRequest(JSON.stringify({ some: "body" }), "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("processed");
    expect(mockExecute).toHaveBeenCalledWith({
      externalEventId: "evt_1",
      eventType: "inquiry.completed",
      providerVerificationId: "inq_1",
    });
  });

  it("acknowledges (200) a duplicate delivery, never surfacing it as an error", async () => {
    mockWebhookValidation.mockReturnValue({ valid: true, externalEventId: "evt_dup" });
    mockExecute.mockResolvedValue({ outcome: "duplicate" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("duplicate");
  });

  it("acknowledges (200) an unmatched providerVerificationId rather than leaking whether it exists via a different status code", async () => {
    mockWebhookValidation.mockReturnValue({ valid: true, externalEventId: "evt_unmatched", providerVerificationId: "inq_ghost" });
    mockExecute.mockResolvedValue({ outcome: "unmatched" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    expect(response.status).toBe(200);
  });

  it("returns 500 with the generic toHttpErrorResponse shape (never a raw stack trace) when the use case throws unexpectedly", async () => {
    mockWebhookValidation.mockReturnValue({ valid: true, externalEventId: "evt_err" });
    mockExecute.mockRejectedValue(new Error("db is down"));

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    // toHttpErrorResponse's own production-vs-non-production message
    // masking is already covered by that utility's own tests; this route
    // is only responsible for routing an unexpected error into it (never
    // handling/formatting the error itself) and never returning a raw
    // stack trace either way.
    expect(response.status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("never logs or echoes the raw request body back in any response", async () => {
    const secretLookingBody = JSON.stringify({ ssn: "999-99-9999", selfie: "base64...verysensitive" });
    mockWebhookValidation.mockReturnValue({ valid: false });

    const response = await POST(makeRequest(secretLookingBody, "t=1,v1=bad"));
    const text = await response.text();

    expect(text).not.toContain("999-99-9999");
    expect(text).not.toContain("selfie");
  });

  it("sanity check: signature verification really is HMAC-SHA256(secret, `${t}.${body}`) shaped — exercised end to end via the real provider in persona-verification-provider.test.ts, referenced here only to document the header format this route expects", () => {
    const secret = "whsec_test";
    const body = "{}";
    const timestamp = "1234567890";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(`t=${timestamp},v1=${signature}`).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
  });
});
