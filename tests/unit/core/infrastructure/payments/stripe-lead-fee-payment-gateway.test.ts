import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { PaymentGatewayError } from "@/domain/errors/domain-error";
import { StripeLeadFeePaymentGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway";

/** Module 140 — adapter tests against a hand-built fake Stripe SDK: no network, no credentials. */
function fakeStripe(intent: Partial<Stripe.PaymentIntent> = {}) {
  const base = { id: "pi_123", client_secret: "pi_123_secret_abc", status: "requires_payment_method", amount: 12100, currency: "eur", ...intent };
  const paymentIntents = {
    create: vi.fn(async () => base),
    retrieve: vi.fn(async () => base),
    cancel: vi.fn(async () => ({ ...base, status: "canceled" })),
  };
  return { stripe: { paymentIntents } as unknown as Stripe, paymentIntents };
}

const REQUEST = { leadPurchaseId: "purchase-1", leadId: "lead-1", amountMinorUnits: 12100, currency: "EUR", idempotencyKey: "lead-fee-payment-intent:purchase-1" };

describe("StripeLeadFeePaymentGatewayAdapter (Module 140)", () => {
  it("creates a PaymentIntent for exactly the minor units given, with the deterministic idempotency key", async () => {
    const { stripe, paymentIntents } = fakeStripe();
    const payment = await new StripeLeadFeePaymentGatewayAdapter(stripe).createPayment(REQUEST);
    expect(paymentIntents.create).toHaveBeenCalledTimes(1);
    const [params, options] = paymentIntents.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params.amount).toBe(12100);
    expect(params.currency).toBe("eur");
    expect(options).toEqual({ idempotencyKey: "lead-fee-payment-intent:purchase-1" });
    expect(payment).toEqual({ reference: "pi_123", clientSecret: "pi_123_secret_abc", status: "REQUIRES_PAYMENT_METHOD", amountMinorUnits: 12100, currency: "EUR" });
  });

  it("is a direct platform lead-fee payment: no manual capture, no Connect / transfer / application fee, no personal data", async () => {
    const { stripe, paymentIntents } = fakeStripe();
    await new StripeLeadFeePaymentGatewayAdapter(stripe).createPayment(REQUEST);
    const [params] = paymentIntents.create.mock.calls[0] as unknown as [Record<string, unknown>];
    for (const forbidden of ["capture_method", "transfer_data", "on_behalf_of", "application_fee_amount", "transfer_group", "customer", "receipt_email", "shipping"]) {
      expect(params).not.toHaveProperty(forbidden);
    }
    expect(params.metadata).toEqual({ flow: "LEAD_V1", purpose: "lead_fee", leadPurchaseId: "purchase-1", leadId: "lead-1" });
  });

  it.each([0, -1, 12.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("refuses a non-positive or non-integer amount (%s) without calling Stripe", async (amount) => {
    const { stripe, paymentIntents } = fakeStripe();
    await expect(new StripeLeadFeePaymentGatewayAdapter(stripe).createPayment({ ...REQUEST, amountMinorUnits: amount })).rejects.toBeInstanceOf(PaymentGatewayError);
    expect(paymentIntents.create).not.toHaveBeenCalled();
  });

  it.each([
    ["requires_payment_method", "REQUIRES_PAYMENT_METHOD"],
    ["requires_confirmation", "REQUIRES_ACTION"],
    ["requires_action", "REQUIRES_ACTION"],
    ["processing", "PROCESSING"],
    ["requires_capture", "PROCESSING"],
    ["succeeded", "SUCCEEDED"],
    ["canceled", "CANCELED"],
  ])("maps Stripe status %s -> %s", async (stripeStatus, expected) => {
    const { stripe } = fakeStripe({ status: stripeStatus as Stripe.PaymentIntent.Status });
    expect((await new StripeLeadFeePaymentGatewayAdapter(stripe).retrievePayment("pi_123")).status).toBe(expected);
  });

  it("retrieve and cancel go to the PaymentIntent API only", async () => {
    const { stripe, paymentIntents } = fakeStripe();
    const adapter = new StripeLeadFeePaymentGatewayAdapter(stripe);
    await adapter.retrievePayment("pi_123");
    await adapter.cancelPayment("pi_123");
    expect(paymentIntents.retrieve).toHaveBeenCalledWith("pi_123");
    expect(paymentIntents.cancel).toHaveBeenCalledWith("pi_123");
  });

  it("maps Stripe SDK errors onto PaymentGatewayError (no SDK error escapes)", async () => {
    const { stripe, paymentIntents } = fakeStripe();
    paymentIntents.create.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "down", type: "api_error" } as never));
    const error = await new StripeLeadFeePaymentGatewayAdapter(stripe).createPayment(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error).toMatchObject({ category: "NETWORK", retryable: true });
    paymentIntents.retrieve.mockRejectedValueOnce(new Error("weird"));
    expect(await new StripeLeadFeePaymentGatewayAdapter(stripe).retrievePayment("x").catch((e: unknown) => e)).toMatchObject({ category: "UNKNOWN" });
  });
});
