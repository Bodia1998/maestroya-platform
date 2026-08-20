import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { PaymentGatewayError } from "@/domain/errors/domain-error";
import { StripePaymentGatewayAdapter, toStripeMinorUnits } from "@/infrastructure/payments/stripe/stripe-payment-gateway";

/**
 * Module 73 — Real Customer Payment Capture.
 *
 * Unit tests for `StripePaymentGatewayAdapter` against a hand-built fake
 * Stripe SDK object — same "fake the SDK client" convention
 * `stripe-connect-gateway.test.ts` (Module 71) uses, no network call, no
 * real Stripe credentials.
 */
function fakeStripe(overrides: Partial<Stripe> = {}): Stripe {
  return {
    paymentIntents: {
      create: vi.fn(),
      capture: vi.fn(),
      cancel: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
    },
    ...overrides,
  } as unknown as Stripe;
}

describe("toStripeMinorUnits (Module 73)", () => {
  it("converts whole-euro amounts to integer cents", () => {
    expect(toStripeMinorUnits(10, "EUR")).toBe(1000);
    expect(toStripeMinorUnits(0.5, "EUR")).toBe(50);
  });

  it("never produces a fractional or floating-point-drift result", () => {
    // The classic 0.1 + 0.2 floating point trap — this must round cleanly
    // to whole cents, never leak a fractional cent from float imprecision.
    expect(toStripeMinorUnits(19.99, "EUR")).toBe(1999);
    expect(toStripeMinorUnits(5400.4, "EUR")).toBe(540040);
    expect(Number.isInteger(toStripeMinorUnits(1234.56, "EUR"))).toBe(true);
  });

  it("rounds rather than truncates, so no cent is silently lost", () => {
    expect(toStripeMinorUnits(10.005, "EUR")).toBe(1001);
  });

  it("rejects a negative or non-finite amount", () => {
    expect(() => toStripeMinorUnits(-1, "EUR")).toThrow(PaymentGatewayError);
    expect(() => toStripeMinorUnits(NaN, "EUR")).toThrow(PaymentGatewayError);
    expect(() => toStripeMinorUnits(Infinity, "EUR")).toThrow(PaymentGatewayError);
  });

  it("rejects a currency other than EUR", () => {
    expect(() => toStripeMinorUnits(10, "USD")).toThrow(PaymentGatewayError);
  });
});

describe("StripePaymentGatewayAdapter (Module 73)", () => {
  describe("authorize", () => {
    it("creates a manual-capture PaymentIntent with the amount converted to integer cents", async () => {
      const stripe = fakeStripe();
      (stripe.paymentIntents.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "pi_123",
        client_secret: "pi_123_secret_abc",
      });
      const adapter = new StripePaymentGatewayAdapter(stripe);

      const result = await adapter.authorize({
        paymentId: "payment-1",
        amount: 120.5,
        currency: "EUR",
        payerId: "user-1",
        metadata: { quoteId: "quote-1" },
        idempotencyKey: "payment-intent:quote:quote-1",
      });

      expect(result).toEqual({ externalReference: "pi_123", clientSecret: "pi_123_secret_abc" });
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 12050,
          currency: "eur",
          capture_method: "manual",
          metadata: expect.objectContaining({ paymentId: "payment-1", payerId: "user-1", quoteId: "quote-1" }),
        }),
        { idempotencyKey: "payment-intent:quote:quote-1" },
      );
    });

    it("never sends the amount as a floating-point/decimal value", async () => {
      const stripe = fakeStripe();
      (stripe.paymentIntents.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "pi_123",
        client_secret: "secret",
      });
      const adapter = new StripePaymentGatewayAdapter(stripe);

      await adapter.authorize({ paymentId: "p1", amount: 99.99, currency: "EUR", payerId: "u1" });

      const createMock = stripe.paymentIntents.create as unknown as ReturnType<typeof vi.fn>;
      const [payload] = createMock.mock.calls[0] as [Record<string, unknown>];
      expect(Number.isInteger(payload.amount)).toBe(true);
    });

    it("omits the idempotencyKey option entirely when none is supplied", async () => {
      const stripe = fakeStripe();
      (stripe.paymentIntents.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "pi_123",
        client_secret: "secret",
      });
      const adapter = new StripePaymentGatewayAdapter(stripe);

      await adapter.authorize({ paymentId: "p1", amount: 10, currency: "EUR", payerId: "u1" });

      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(expect.anything(), undefined);
    });

    it("maps a Stripe card error to a non-retryable CARD_DECLINED PaymentGatewayError", async () => {
      const stripe = fakeStripe();
      const cardError = new Stripe.errors.StripeCardError({
        type: "card_error",
        code: "card_declined",
        message: "Your card was declined.",
      } as never);
      (stripe.paymentIntents.create as ReturnType<typeof vi.fn>).mockRejectedValue(cardError);
      const adapter = new StripePaymentGatewayAdapter(stripe);

      await expect(
        adapter.authorize({ paymentId: "p1", amount: 10, currency: "EUR", payerId: "u1" }),
      ).rejects.toMatchObject({ category: "CARD_DECLINED", retryable: false });
    });

    it("maps a Stripe rate limit error to a retryable error", async () => {
      const stripe = fakeStripe();
      const rateLimitError = new Stripe.errors.StripeRateLimitError({
        type: "rate_limit_error",
        message: "Too many requests.",
      } as never);
      (stripe.paymentIntents.create as ReturnType<typeof vi.fn>).mockRejectedValue(rateLimitError);
      const adapter = new StripePaymentGatewayAdapter(stripe);

      await expect(
        adapter.authorize({ paymentId: "p1", amount: 10, currency: "EUR", payerId: "u1" }),
      ).rejects.toMatchObject({ category: "RATE_LIMITED", retryable: true });
    });

    it("never leaks a raw Stripe SDK error type past the adapter", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeAuthenticationError({
        type: "invalid_request_error",
        message: "Invalid API key.",
      } as never);
      (stripe.paymentIntents.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripePaymentGatewayAdapter(stripe);

      const thrown = await adapter
        .authorize({ paymentId: "p1", amount: 10, currency: "EUR", payerId: "u1" })
        .catch((e: unknown) => e);

      expect(thrown).not.toBeInstanceOf(Stripe.errors.StripeError);
      expect(thrown).toBeInstanceOf(PaymentGatewayError);
    });
  });

  describe("capture", () => {
    it("calls paymentIntents.capture with the external reference", async () => {
      const stripe = fakeStripe();
      (stripe.paymentIntents.capture as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const adapter = new StripePaymentGatewayAdapter(stripe);

      await adapter.capture("pi_123");

      expect(stripe.paymentIntents.capture).toHaveBeenCalledWith("pi_123");
    });
  });

  describe("cancel", () => {
    it("calls paymentIntents.cancel with the external reference", async () => {
      const stripe = fakeStripe();
      (stripe.paymentIntents.cancel as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const adapter = new StripePaymentGatewayAdapter(stripe);

      await adapter.cancel("pi_123");

      expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_123");
    });
  });

  describe("refund", () => {
    it("calls stripe.refunds.create against the PaymentIntent with the amount converted to integer cents", async () => {
      const stripe = fakeStripe();
      (stripe.refunds.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "re_123", status: "succeeded" });
      const adapter = new StripePaymentGatewayAdapter(stripe);

      const result = await adapter.refund("pi_123", 19.99, { idempotencyKey: "refund:adj-1" });

      expect(stripe.refunds.create).toHaveBeenCalledWith(
        { payment_intent: "pi_123", amount: 1999 },
        { idempotencyKey: "refund:adj-1" },
      );
      expect(result).toEqual({ externalRefundReference: "re_123", status: "SUCCEEDED" });
    });

    it("maps a pending/requires_action Stripe refund status to PENDING", async () => {
      const stripe = fakeStripe();
      (stripe.refunds.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "re_124", status: "pending" });
      const adapter = new StripePaymentGatewayAdapter(stripe);

      const result = await adapter.refund("pi_123", 10);
      expect(result.status).toBe("PENDING");
    });

    it("maps a Stripe error onto PaymentGatewayError, never swallowing it", async () => {
      const stripe = fakeStripe();
      (stripe.refunds.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Stripe.errors.StripeInvalidRequestError({ message: "Charge already refunded.", type: "invalid_request_error" } as never),
      );
      const adapter = new StripePaymentGatewayAdapter(stripe);

      await expect(adapter.refund("pi_123", 10)).rejects.toBeInstanceOf(PaymentGatewayError);
    });
  });
});
