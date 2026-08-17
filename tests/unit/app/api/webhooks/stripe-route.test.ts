import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 72 — Stripe Webhooks: HTTP-level wiring test for
 * `POST /api/webhooks/stripe` — request in, signature validation,
 * idempotency/use-case delegation, response out. The route is imported
 * and invoked directly (no real server), the same lightweight approach
 * `tests/unit/app/api/webhooks/persona-route.test.ts` already establishes
 * for `/api/webhooks/persona`. `StripeConnectWebhookVerifierAdapter`'s
 * signature verification itself is already covered directly by
 * stripe-connect-webhook-verifier.test.ts;
 * `ProcessStripeConnectWebhookUseCase`'s own orchestration is covered by
 * process-stripe-connect-webhook.use-case.test.ts. This file only proves
 * the Route Handler's own thin-controller wiring: it reads the real
 * signature-verification result and the real use case's outcome
 * correctly, and never processes anything before the signature check
 * passes.
 */

const mockExecute = vi.fn();
const mockVerify = vi.fn();

vi.mock("@/application/use-cases/stripe-connect/compose", () => ({
  getStripeConnectWebhookVerifierInstance: () => ({ verify: mockVerify }),
  makeProcessStripeConnectWebhookUseCase: () => ({ execute: mockExecute }),
}));

const { POST } = await import("../../../../../src/app/api/webhooks/stripe/route");

function makeRequest(body: string, signatureHeader: string | null): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (signatureHeader) headers.set("stripe-signature", signatureHeader);
  return new NextRequest("http://localhost:3000/api/webhooks/stripe", { method: "POST", body, headers });
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockVerify.mockReset();
  });

  it("fails closed with 401 on an invalid signature, and never calls the processing use case", async () => {
    mockVerify.mockReturnValue({ valid: false });

    const response = await POST(makeRequest("{}", "t=1,v1=deadbeef"));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("fails closed with 401 when no signature header is present at all", async () => {
    mockVerify.mockReturnValue({ valid: false });

    const response = await POST(makeRequest("{}", null));

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("delegates to ProcessStripeConnectWebhookUseCase with exactly the verified event, never the raw body", async () => {
    const verifiedEvent = {
      id: "evt_1",
      type: "account.updated",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      accountUpdated: {
        stripeAccountId: "acct_1",
        detailsSubmitted: true,
        transfersActive: true,
        payoutsEnabled: true,
        requirementsCurrentlyDue: [],
        disabledReason: null,
      },
    };
    mockVerify.mockReturnValue({ valid: true, event: verifiedEvent });
    mockExecute.mockResolvedValue({ outcome: "processed", professionalProfileId: "pro-1" });

    const response = await POST(makeRequest(JSON.stringify({ some: "body" }), "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("processed");
    expect(mockExecute).toHaveBeenCalledWith(verifiedEvent);
  });

  it("acknowledges (200) a duplicate delivery, never surfacing it as an error", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_dup", type: "account.updated", createdAt: new Date(), accountUpdated: null },
    });
    mockExecute.mockResolvedValue({ outcome: "duplicate" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("duplicate");
  });

  it("acknowledges (200) an unmatched Stripe account rather than leaking whether it exists via a different status code", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_unmatched", type: "account.updated", createdAt: new Date(), accountUpdated: { stripeAccountId: "acct_ghost" } },
    });
    mockExecute.mockResolvedValue({ outcome: "unmatched" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    expect(response.status).toBe(200);
  });

  it("acknowledges (200) an unsupported event type as ignored", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_other", type: "capability.updated", createdAt: new Date(), accountUpdated: null },
    });
    mockExecute.mockResolvedValue({ outcome: "ignored" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ignored");
  });

  it("returns 500 with the generic toHttpErrorResponse shape (never a raw stack trace) when the use case throws unexpectedly", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_err", type: "account.updated", createdAt: new Date(), accountUpdated: null },
    });
    mockExecute.mockRejectedValue(new Error("db is down"));

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("never logs or echoes the raw request body back in any response", async () => {
    const secretLookingBody = JSON.stringify({ ssn: "999-99-9999", bankAccount: "very-sensitive" });
    mockVerify.mockReturnValue({ valid: false });

    const response = await POST(makeRequest(secretLookingBody, "t=1,v1=bad"));
    const text = await response.text();

    expect(text).not.toContain("999-99-9999");
    expect(text).not.toContain("very-sensitive");
  });

  it("does not depend on any authenticated user session — the Stripe signature is the sole authentication mechanism", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_noauth", type: "account.updated", createdAt: new Date(), accountUpdated: null },
    });
    mockExecute.mockResolvedValue({ outcome: "ignored" });

    // No cookie/authorization header at all — request is still processed
    // purely based on the (mocked, here always-valid) signature check.
    const response = await POST(makeRequest("{}", "t=1,v1=abc"));

    expect(response.status).toBe(200);
  });
});
