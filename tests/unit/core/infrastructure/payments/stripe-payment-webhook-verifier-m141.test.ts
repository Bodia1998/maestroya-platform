import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { StripePaymentWebhookVerifierAdapter } from "@/infrastructure/payments/stripe/stripe-payment-webhook-verifier";

/**
 * Module 141 — REAL Stripe signature verification (no SDK fake): payloads are signed with
 * Stripe's own test-header generator and verified by `constructEvent` over the raw body.
 */
const SECRET = "whsec_m141_test_secret";
const stripe = new Stripe("sk_test_m141_placeholder");
const verifier = new StripePaymentWebhookVerifierAdapter(stripe, SECRET);

function payload(type = "payment_intent.succeeded", intent: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_m141",
    object: "event",
    api_version: "2024-12-18.acacia",
    created: 1735689600,
    type,
    data: {
      object: {
        id: "pi_m141",
        object: "payment_intent",
        amount: 12100,
        currency: "eur",
        status: "succeeded",
        last_payment_error: null,
        metadata: { flow: "LEAD_V1", purpose: "lead_fee", leadPurchaseId: "purchase-1", leadId: "lead-1" },
        ...intent,
      },
    },
  });
}
const sign = (body: string, secret = SECRET) => stripe.webhooks.generateTestHeaderString({ payload: body, secret });

describe("M141 — Stripe signature verification at the webhook boundary", () => {
  it("accepts a correctly signed raw body and exposes the LEAD_V1 facts", () => {
    const body = payload();
    const result = verifier.verify(body, sign(body));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.event.paymentIntent).toMatchObject({
      paymentIntentId: "pi_m141",
      amountMinorUnits: 12100,
      currency: "eur",
      flow: "LEAD_V1",
      leadPurchaseId: "purchase-1",
      leadId: "lead-1",
    });
  });

  it("rejects an invalid signature (wrong secret)", () => {
    const body = payload();
    expect(verifier.verify(body, sign(body, "whsec_attacker"))).toEqual({ valid: false });
  });

  it("rejects a body altered after signing (raw-body integrity)", () => {
    const body = payload();
    const header = sign(body);
    expect(verifier.verify(body.replace("12100", "100"), header)).toEqual({ valid: false });
  });

  it("rejects a missing / empty / garbage signature header", () => {
    const body = payload();
    expect(verifier.verify(body, null)).toEqual({ valid: false });
    expect(verifier.verify(body, "")).toEqual({ valid: false });
    expect(verifier.verify(body, "t=1,v1=deadbeef")).toEqual({ valid: false });
    expect(verifier.verify(body, "not-a-signature")).toEqual({ valid: false });
  });

  it("rejects a malformed payload even when it is validly signed over those exact bytes", () => {
    const bad = "{not json";
    expect(verifier.verify(bad, sign(bad))).toEqual({ valid: false });
  });

  it("legacy intents keep their exact legacy payload shape (no M141 fields at all)", () => {
    for (const metadata of [{}, { flow: "SOMETHING_ELSE", leadPurchaseId: "x" }]) {
      const body = payload("payment_intent.succeeded", { metadata });
      const result = verifier.verify(body, sign(body));
      expect(result.valid && result.event.paymentIntent).toEqual({ paymentIntentId: "pi_m141", lastPaymentErrorMessage: null });
    }
  });

  it("passes a malformed amount through raw (validated downstream), never coerces it", () => {
    const body = payload("payment_intent.succeeded", { amount: "12100" });
    const result = verifier.verify(body, sign(body));
    expect(result.valid && result.event.paymentIntent?.amountMinorUnits).toBe("12100");
  });
});
