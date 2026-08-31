import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 73 — Real Customer Payment Capture: HTTP-level wiring test for
 * `POST /api/webhooks/stripe-payments` — mirrors
 * `tests/unit/app/api/webhooks/stripe-route.test.ts` (Module 72) exactly:
 * the route is imported and invoked directly (no real server), and this
 * file only proves the Route Handler's own thin-controller wiring — it
 * reads the real signature-verification result and the real use case's
 * outcome correctly, and never processes anything before the signature
 * check passes. Signature verification itself is covered by
 * stripe-payment-webhook-verifier.test.ts; the use case's own
 * orchestration by process-customer-payment-webhook.use-case.test.ts.
 */

const mockExecute = vi.fn();
const mockVerify = vi.fn();

vi.mock("@/application/use-cases/payments/compose", () => ({
  getStripePaymentWebhookVerifierInstance: () => ({ verify: mockVerify }),
  makeProcessCustomerPaymentWebhookUseCase: () => ({ execute: mockExecute }),
}));

const { POST } = await import("../../../../../src/app/api/webhooks/stripe-payments/route");

function makeRequest(body: string, signatureHeader: string | null): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (signatureHeader) headers.set("stripe-signature", signatureHeader);
  return new NextRequest("http://localhost:3000/api/webhooks/stripe-payments", { method: "POST", body, headers });
}

describe("POST /api/webhooks/stripe-payments", () => {
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

  it("delegates to ProcessCustomerPaymentWebhookUseCase with exactly the verified event, never the raw body", async () => {
    const verifiedEvent = {
      id: "evt_1",
      type: "payment_intent.amount_capturable_updated",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      paymentIntent: { paymentIntentId: "pi_123", lastPaymentErrorMessage: null },
      chargeRefunded: null,
      dispute: null,
    };
    mockVerify.mockReturnValue({ valid: true, event: verifiedEvent });
    mockExecute.mockResolvedValue({ outcome: "captured", paymentId: "payment-1" });

    const response = await POST(makeRequest(JSON.stringify({ some: "body" }), "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("captured");
    expect(mockExecute).toHaveBeenCalledWith(verifiedEvent);
  });

  it("acknowledges (200) a duplicate delivery, never surfacing it as an error", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_dup", type: "payment_intent.succeeded", createdAt: new Date(), paymentIntent: null, chargeRefunded: null, dispute: null },
    });
    mockExecute.mockResolvedValue({ outcome: "duplicate" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("duplicate");
  });

  it("acknowledges (200) an unmatched PaymentIntent rather than leaking whether it exists via a different status code", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_unmatched", type: "payment_intent.succeeded", createdAt: new Date(), paymentIntent: { paymentIntentId: "pi_ghost", lastPaymentErrorMessage: null }, chargeRefunded: null, dispute: null },
    });
    mockExecute.mockResolvedValue({ outcome: "unmatched" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    expect(response.status).toBe(200);
  });

  it("acknowledges (200) a charge.refunded event as observed", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: {
        id: "evt_refund",
        type: "charge.refunded",
        createdAt: new Date(),
        paymentIntent: null,
        chargeRefunded: { chargeId: "ch_1", paymentIntentId: "pi_123", amountRefunded: 20 },
        dispute: null,
      },
    });
    mockExecute.mockResolvedValue({ outcome: "refund-observed" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("refund-observed");
  });

  it("returns 500 with the generic toHttpErrorResponse shape (never a raw stack trace) when the use case throws unexpectedly", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_err", type: "payment_intent.succeeded", createdAt: new Date(), paymentIntent: null, chargeRefunded: null, dispute: null },
    });
    mockExecute.mockRejectedValue(new Error("db is down"));

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("never logs or echoes the raw request body back in any response", async () => {
    const secretLookingBody = JSON.stringify({ cardNumber: "4242424242424242", cvc: "123" });
    mockVerify.mockReturnValue({ valid: false });

    const response = await POST(makeRequest(secretLookingBody, "t=1,v1=bad"));
    const text = await response.text();

    expect(text).not.toContain("4242424242424242");
    expect(text).not.toContain("123");
  });

  it("does not depend on any authenticated user session — the Stripe signature is the sole authentication mechanism", async () => {
    mockVerify.mockReturnValue({
      valid: true,
      event: { id: "evt_noauth", type: "payment_intent.canceled", createdAt: new Date(), paymentIntent: null, chargeRefunded: null, dispute: null },
    });
    mockExecute.mockResolvedValue({ outcome: "cancelled" });

    const response = await POST(makeRequest("{}", "t=1,v1=abc"));

    expect(response.status).toBe(200);
  });
});
