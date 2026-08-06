import { describe, expect, it } from "vitest";

import { Payment } from "@/domain/entities/payment";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { InvalidPaymentTransitionError, ValidationError } from "@/domain/errors/domain-error";

function createPayment(overrides: Partial<Parameters<typeof Payment.create>[0]> = {}) {
  return Payment.create({
    serviceRequestId: "sr_1",
    payerId: "user_1",
    amount: 100,
    ...overrides,
  });
}

describe("domain/entities/payment", () => {
  describe("create", () => {
    it("creates a PENDING payment with sensible defaults", () => {
      const payment = createPayment();

      expect(payment.status).toBe("PENDING");
      expect(payment.amount).toBe(100);
      expect(payment.currency).toBe("EUR");
      expect(payment.refundedAmount).toBe(0);
      expect(payment.remainingRefundableAmount).toBe(100);
      expect(payment.failureReason).toBeNull();
      expect(payment.capturedAt).toBeNull();
      expect(payment.isTerminal).toBe(false);
      expect(payment.id).toBeTruthy();
    });

    it("accepts an explicit id and currency", () => {
      const payment = createPayment({ id: "payment_123", currency: "USD" });

      expect(payment.id).toBe("payment_123");
      expect(payment.currency).toBe("USD");
    });

    it("rejects a missing serviceRequestId", () => {
      expect(() => createPayment({ serviceRequestId: "" })).toThrow(ValidationError);
    });

    it("rejects a missing payerId", () => {
      expect(() => createPayment({ payerId: "  " })).toThrow(ValidationError);
    });

    it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects a non-positive or non-finite amount (%s)",
      (amount) => {
        expect(() => createPayment({ amount })).toThrow(ValidationError);
      },
    );

    it("rejects a malformed currency code", () => {
      expect(() => createPayment({ currency: "eur" })).toThrow(ValidationError);
      expect(() => createPayment({ currency: "EURO" })).toThrow(ValidationError);
    });
  });

  describe("reconstitute", () => {
    it("rehydrates state without re-running create()'s validation", () => {
      const payment = Payment.reconstitute(
        {
          serviceRequestId: "sr_1",
          payerId: "user_1",
          amount: 50,
          currency: "EUR",
          status: "CAPTURED",
          refundedAmount: 0,
          failureReason: null,
          capturedAt: new Date("2026-01-01"),
        },
        "payment_existing",
      );

      expect(payment.id).toBe("payment_existing");
      expect(payment.status).toBe("CAPTURED");
      expect(payment.capturedAt).toEqual(new Date("2026-01-01"));
    });
  });

  describe("valid state transitions", () => {
    it("authorize(): PENDING -> AUTHORIZED", () => {
      const payment = createPayment();
      payment.authorize();
      expect(payment.status).toBe("AUTHORIZED");
    });

    it("capture(): PENDING -> CAPTURED directly (no prior authorization required)", () => {
      const payment = createPayment();
      const capturedAt = new Date("2026-02-01T10:00:00Z");
      payment.capture(capturedAt);

      expect(payment.status).toBe("CAPTURED");
      expect(payment.capturedAt).toBe(capturedAt);
    });

    it("capture(): AUTHORIZED -> CAPTURED", () => {
      const payment = createPayment();
      payment.authorize();
      payment.capture();
      expect(payment.status).toBe("CAPTURED");
    });

    it("capture() defaults capturedAt to now and clears any prior failureReason", () => {
      const payment = createPayment();
      payment.capture();
      expect(payment.capturedAt).toBeInstanceOf(Date);
    });

    it("fail(): PENDING -> FAILED, recording the reason", () => {
      const payment = createPayment();
      payment.fail("card_declined");
      expect(payment.status).toBe("FAILED");
      expect(payment.failureReason).toBe("card_declined");
      expect(payment.isTerminal).toBe(true);
    });

    it("fail(): AUTHORIZED -> FAILED", () => {
      const payment = createPayment();
      payment.authorize();
      payment.fail("insufficient_funds");
      expect(payment.status).toBe("FAILED");
    });

    it("cancel(): PENDING -> CANCELLED", () => {
      const payment = createPayment();
      payment.cancel();
      expect(payment.status).toBe("CANCELLED");
      expect(payment.isTerminal).toBe(true);
    });

    it("cancel(): AUTHORIZED -> CANCELLED", () => {
      const payment = createPayment();
      payment.authorize();
      payment.cancel();
      expect(payment.status).toBe("CANCELLED");
    });

    it("refund(): full refund moves CAPTURED -> REFUNDED", () => {
      const payment = createPayment({ amount: 100 });
      payment.capture();
      payment.refund(100);

      expect(payment.status).toBe("REFUNDED");
      expect(payment.refundedAmount).toBe(100);
      expect(payment.remainingRefundableAmount).toBe(0);
      expect(payment.isTerminal).toBe(true);
    });

    it("refund(): partial refund moves CAPTURED -> PARTIALLY_REFUNDED and stays non-terminal", () => {
      const payment = createPayment({ amount: 100 });
      payment.capture();
      payment.refund(40);

      expect(payment.status).toBe("PARTIALLY_REFUNDED");
      expect(payment.refundedAmount).toBe(40);
      expect(payment.remainingRefundableAmount).toBe(60);
      expect(payment.isTerminal).toBe(false);
    });

    it("refund(): a second partial refund accumulates and can complete the refund", () => {
      const payment = createPayment({ amount: 100 });
      payment.capture();
      payment.refund(40);
      payment.refund(60);

      expect(payment.status).toBe("REFUNDED");
      expect(payment.refundedAmount).toBe(100);
    });
  });

  describe("invalid state transitions", () => {
    it("authorize() twice throws", () => {
      const payment = createPayment();
      payment.authorize();
      expect(() => payment.authorize()).toThrow(InvalidPaymentTransitionError);
    });

    it("capture() on an already-CAPTURED payment throws", () => {
      const payment = createPayment();
      payment.capture();
      expect(() => payment.capture()).toThrow(InvalidPaymentTransitionError);
    });

    it("capture() on a FAILED payment throws", () => {
      const payment = createPayment();
      payment.fail("declined");
      expect(() => payment.capture()).toThrow(InvalidPaymentTransitionError);
    });

    it("capture() on a CANCELLED payment throws", () => {
      const payment = createPayment();
      payment.cancel();
      expect(() => payment.capture()).toThrow(InvalidPaymentTransitionError);
    });

    it("cancel() after capture throws", () => {
      const payment = createPayment();
      payment.capture();
      expect(() => payment.cancel()).toThrow(InvalidPaymentTransitionError);
    });

    it("fail() on a terminal payment throws", () => {
      const payment = createPayment();
      payment.cancel();
      expect(() => payment.fail("too_late")).toThrow(InvalidPaymentTransitionError);
    });

    it("fail() requires a non-empty reason", () => {
      const payment = createPayment();
      expect(() => payment.fail("")).toThrow(ValidationError);
      expect(() => payment.fail("   ")).toThrow(ValidationError);
    });

    it("refund() on a PENDING payment throws", () => {
      const payment = createPayment();
      expect(() => payment.refund(10)).toThrow(InvalidPaymentTransitionError);
    });

    it("refund() on a FAILED payment throws", () => {
      const payment = createPayment();
      payment.fail("declined");
      expect(() => payment.refund(10)).toThrow(InvalidPaymentTransitionError);
    });

    it("refund() beyond the remaining refundable amount throws and leaves state unchanged", () => {
      const payment = createPayment({ amount: 100 });
      payment.capture();
      payment.refund(40);

      expect(() => payment.refund(70)).toThrow(ValidationError);
      expect(payment.status).toBe("PARTIALLY_REFUNDED");
      expect(payment.refundedAmount).toBe(40);
    });

    it.each([0, -5, Number.NaN])("refund() rejects a non-positive amount (%s)", (amount) => {
      const payment = createPayment({ amount: 100 });
      payment.capture();
      expect(() => payment.refund(amount)).toThrow(ValidationError);
    });
  });

  describe("domain events", () => {
    it("capture() raises exactly one PaymentCaptured event", () => {
      const payment = createPayment({ amount: 75, currency: "EUR" });
      payment.capture();

      const events = payment.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PaymentCaptured);

      const event = events[0] as PaymentCaptured;
      expect(event.paymentId).toBe(payment.id);
      expect(event.amount).toBe(75);
      expect(event.currency).toBe("EUR");
      expect(event.eventName).toBe("payment.captured");
    });

    it("pullDomainEvents() drains the queue — a second call returns nothing new", () => {
      const payment = createPayment();
      payment.capture();

      expect(payment.pullDomainEvents()).toHaveLength(1);
      expect(payment.pullDomainEvents()).toHaveLength(0);
    });

    it("no event is raised by authorize/fail/cancel/refund", () => {
      const authorized = createPayment();
      authorized.authorize();
      expect(authorized.pullDomainEvents()).toHaveLength(0);

      const failed = createPayment();
      failed.fail("declined");
      expect(failed.pullDomainEvents()).toHaveLength(0);

      const cancelled = createPayment();
      cancelled.cancel();
      expect(cancelled.pullDomainEvents()).toHaveLength(0);

      const refunded = createPayment();
      refunded.capture();
      refunded.pullDomainEvents(); // drain the CAPTURED event first
      refunded.refund(10);
      expect(refunded.pullDomainEvents()).toHaveLength(0);
    });
  });

  describe("equals (inherited from Entity)", () => {
    it("two payments are equal iff their ids match", () => {
      const a = Payment.create({ id: "p1", serviceRequestId: "sr", payerId: "u", amount: 10 });
      const b = Payment.create({ id: "p1", serviceRequestId: "sr2", payerId: "u2", amount: 20 });
      const c = Payment.create({ id: "p2", serviceRequestId: "sr", payerId: "u", amount: 10 });

      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
      expect(a.equals(undefined)).toBe(false);
    });
  });
});
