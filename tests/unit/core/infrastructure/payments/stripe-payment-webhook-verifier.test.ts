import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { StripePaymentWebhookVerifierAdapter } from "@/infrastructure/payments/stripe/stripe-payment-webhook-verifier";

/**
 * Module 73 — Real Customer Payment Capture.
 *
 * Unit tests for `StripePaymentWebhookVerifierAdapter` against a
 * hand-built fake Stripe SDK object — same "fake the SDK client"
 * convention `stripe-connect-webhook-verifier.test.ts` (Module 72) uses.
 */
function fakeStripe(constructEvent: (...args: unknown[]) => Stripe.Event): Stripe {
  return {
    webhooks: {
      constructEvent: vi.fn(constructEvent),
    },
  } as unknown as Stripe;
}

function fakePaymentIntentEvent(type: string, overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_1",
    object: "event",
    type,
    created: 1735689600,
    data: {
      object: {
        id: "pi_123",
        object: "payment_intent",
        last_payment_error: null,
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function fakeChargeRefundedEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_2",
    object: "event",
    type: "charge.refunded",
    created: 1735689600,
    data: {
      object: {
        id: "ch_123",
        object: "charge",
        payment_intent: "pi_123",
        amount_refunded: 500,
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

describe("StripePaymentWebhookVerifierAdapter (Module 73)", () => {
  it("accepts a validly-signed payment_intent.amount_capturable_updated event", () => {
    const stripe = fakeStripe(() => fakePaymentIntentEvent("payment_intent.amount_capturable_updated"));
    const adapter = new StripePaymentWebhookVerifierAdapter(stripe, "whsec_payments_test");

    const result = adapter.verify("{}", "t=1,v1=validsig");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.id).toBe("evt_1");
      expect(result.event.type).toBe("payment_intent.amount_capturable_updated");
      expect(result.event.paymentIntent).toEqual({ paymentIntentId: "pi_123", lastPaymentErrorMessage: null });
      expect(result.event.chargeRefunded).toBeNull();
    }
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith("{}", "t=1,v1=validsig", "whsec_payments_test");
  });

  it("extracts the decline message on payment_intent.payment_failed", () => {
    const stripe = fakeStripe(() =>
      fakePaymentIntentEvent("payment_intent.payment_failed", {
        last_payment_error: { message: "Your card was declined." },
      }),
    );
    const adapter = new StripePaymentWebhookVerifierAdapter(stripe, "whsec_payments_test");

    const result = adapter.verify("{}", "t=1,v1=validsig");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.paymentIntent).toEqual({
        paymentIntentId: "pi_123",
        lastPaymentErrorMessage: "Your card was declined.",
      });
    }
  });

  it("extracts charge.refunded fields, converted from minor units", () => {
    const stripe = fakeStripe(() => fakeChargeRefundedEvent());
    const adapter = new StripePaymentWebhookVerifierAdapter(stripe, "whsec_payments_test");

    const result = adapter.verify("{}", "t=1,v1=validsig");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.paymentIntent).toBeNull();
      expect(result.event.chargeRefunded).toEqual({
        chargeId: "ch_123",
        paymentIntentId: "pi_123",
        amountRefunded: 5,
      });
    }
  });

  it("returns paymentIntent: null for an event type it doesn't recognize", () => {
    const stripe = fakeStripe(() => ({ id: "evt_x", type: "customer.created", created: 1735689600, data: { object: {} } }) as unknown as Stripe.Event);
    const adapter = new StripePaymentWebhookVerifierAdapter(stripe, "whsec_payments_test");

    const result = adapter.verify("{}", "t=1,v1=validsig");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.paymentIntent).toBeNull();
      expect(result.event.chargeRefunded).toBeNull();
    }
  });

  it("rejects when the signature header is missing, without calling constructEvent", () => {
    const constructEvent = vi.fn();
    const stripe = fakeStripe(constructEvent);
    const adapter = new StripePaymentWebhookVerifierAdapter(stripe, "whsec_payments_test");

    const result = adapter.verify("{}", null);

    expect(result.valid).toBe(false);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature without throwing, and never leaks the reason", () => {
    const stripe = fakeStripe(() => {
      throw new Stripe.errors.StripeSignatureVerificationError({
        message: "No signatures found matching the expected signature for payload.",
      } as never);
    });
    const adapter = new StripePaymentWebhookVerifierAdapter(stripe, "whsec_payments_test");

    const result = adapter.verify("{}", "t=1,v1=badsig");

    expect(result).toEqual({ valid: false });
  });

  it("rejects a malformed body (JSON parse failure) without throwing", () => {
    const stripe = fakeStripe(() => {
      throw new SyntaxError("Unexpected token");
    });
    const adapter = new StripePaymentWebhookVerifierAdapter(stripe, "whsec_payments_test");

    const result = adapter.verify("not json", "t=1,v1=validsig");

    expect(result).toEqual({ valid: false });
  });
});
