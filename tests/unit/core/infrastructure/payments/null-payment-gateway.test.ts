import { describe, expect, it } from "vitest";

import {
  NullPaymentGateway,
  PaymentGatewayNotConfiguredError,
} from "@/infrastructure/payments/null-payment-gateway";
import type { PaymentAuthorizationRequest, PaymentGateway } from "@/application/ports/payment-gateway";

/**
 * Runs the same behavioral contract against any `PaymentGateway`
 * implementation. Today there is exactly one (`NullPaymentGateway`), but
 * writing this as a reusable contract now means Module 59's
 * `StripeConnectPaymentGateway` test suite can import and reuse it (with
 * appropriate mocking/expectations swapped in) rather than starting from
 * scratch — the same "contract test" idea the module brief asks for.
 */
function paymentGatewayContract(_name: string, gateway: PaymentGateway) {
  it("exposes authorize, capture, refund, and cancel", () => {
    expect(typeof gateway.authorize).toBe("function");
    expect(typeof gateway.capture).toBe("function");
    expect(typeof gateway.refund).toBe("function");
    expect(typeof gateway.cancel).toBe("function");
  });
}

describe("application/ports/payment-gateway contract", () => {
  describe("NullPaymentGateway", () => {
    paymentGatewayContract("NullPaymentGateway", new NullPaymentGateway());
  });
});

describe("infrastructure/payments/null-payment-gateway", () => {
  const request: PaymentAuthorizationRequest = {
    paymentId: "payment_1",
    amount: 100,
    currency: "EUR",
    payerId: "user_1",
  };

  it("authorize() rejects with PaymentGatewayNotConfiguredError and never resolves a reference", async () => {
    const gateway = new NullPaymentGateway();
    await expect(gateway.authorize(request)).rejects.toBeInstanceOf(PaymentGatewayNotConfiguredError);
    await expect(gateway.authorize(request)).rejects.toThrow(/authorize/);
  });

  it("capture() rejects with PaymentGatewayNotConfiguredError", async () => {
    const gateway = new NullPaymentGateway();
    await expect(gateway.capture("ext_ref")).rejects.toBeInstanceOf(PaymentGatewayNotConfiguredError);
    await expect(gateway.capture("ext_ref")).rejects.toThrow(/capture/);
  });

  it("refund() rejects with PaymentGatewayNotConfiguredError", async () => {
    const gateway = new NullPaymentGateway();
    await expect(gateway.refund("ext_ref", 50)).rejects.toBeInstanceOf(PaymentGatewayNotConfiguredError);
    await expect(gateway.refund("ext_ref", 50)).rejects.toThrow(/refund/);
  });

  it("cancel() rejects with PaymentGatewayNotConfiguredError", async () => {
    const gateway = new NullPaymentGateway();
    await expect(gateway.cancel("ext_ref")).rejects.toBeInstanceOf(PaymentGatewayNotConfiguredError);
    await expect(gateway.cancel("ext_ref")).rejects.toThrow(/cancel/);
  });

  it("performs no real processing — every call rejects rather than silently succeeding", async () => {
    const gateway = new NullPaymentGateway();
    const outcomes = await Promise.allSettled([
      gateway.authorize(request),
      gateway.capture("x"),
      gateway.refund("x", 1),
      gateway.cancel("x"),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
    }
  });
});

describe("infrastructure/payments/compose", () => {
  it("wires a singleton StripePaymentGatewayAdapter as the platform's PaymentGateway (Module 73)", async () => {
    // Module 73 — Real Customer Payment Capture: as predicted by
    // compose.ts's own original Module 35 doc comment, this is the one
    // place that changed to swap NullPaymentGateway for the real
    // implementation — see stripe-payment-gateway.test.ts for
    // StripePaymentGatewayAdapter's own behavior.
    const { StripePaymentGatewayAdapter } = await import("@/infrastructure/payments/stripe/stripe-payment-gateway");
    const { paymentGateway, makePaymentGateway } = await import("@/infrastructure/payments/compose");

    expect(paymentGateway).toBeInstanceOf(StripePaymentGatewayAdapter);
    expect(makePaymentGateway()).toBe(paymentGateway);
  });
});
