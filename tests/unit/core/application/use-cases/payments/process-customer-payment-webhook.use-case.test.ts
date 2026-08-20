import { beforeEach, describe, expect, it } from "vitest";

import { PaymentCaptured } from "@/domain/events/payment-captured";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import {
  STRIPE_PAYMENTS_WEBHOOK_PROVIDER,
  ProcessCustomerPaymentWebhookUseCase,
} from "@/application/use-cases/payments/process-customer-payment-webhook.use-case";
import { FakeEventBus, FakeExternalWebhookEventRepository, FakePaymentGateway, FakePaymentRepository } from "./fakes";

/**
 * Module 73 — Real Customer Payment Capture: application-level tests for
 * `ProcessCustomerPaymentWebhookUseCase`. HTTP wiring itself is covered
 * separately by `tests/unit/app/api/webhooks/stripe-payments-route.test.ts`,
 * signature verification by `stripe-payment-webhook-verifier.test.ts` —
 * same split `process-stripe-connect-webhook.use-case.test.ts` (Module 72)
 * establishes.
 */
function paymentIntentEvent(
  type: string,
  overrides: Partial<StripePaymentWebhookEvent> = {},
): StripePaymentWebhookEvent {
  return {
    id: "evt_1",
    type,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    paymentIntent: { paymentIntentId: "pi_123", lastPaymentErrorMessage: null },
    chargeRefunded: null,
    ...overrides,
  };
}

function seedPendingPayment(payments: FakePaymentRepository, overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  const record: PaymentRecord = {
    id: "payment-1",
    serviceRequestId: "request-1",
    quoteId: "quote-1",
    jobId: "job-1",
    payerId: "user-1",
    amount: 100,
    currency: "EUR",
    status: "PENDING",
    capturedAt: null,
    stripePaymentIntentId: "pi_123",
    method: "CARD",
    failureReason: null,
    ...overrides,
  };
  payments.seed(record);
  return record;
}

describe("ProcessCustomerPaymentWebhookUseCase (Module 73)", () => {
  let payments: FakePaymentRepository;
  let gateway: FakePaymentGateway;
  let webhookEvents: FakeExternalWebhookEventRepository;
  let eventBus: FakeEventBus;
  let useCase: ProcessCustomerPaymentWebhookUseCase;

  beforeEach(() => {
    payments = new FakePaymentRepository();
    gateway = new FakePaymentGateway();
    webhookEvents = new FakeExternalWebhookEventRepository();
    eventBus = new FakeEventBus();
    useCase = new ProcessCustomerPaymentWebhookUseCase(payments, gateway, webhookEvents, eventBus);
  });

  describe("payment_intent.amount_capturable_updated", () => {
    it("captures the PaymentIntent and transitions the Payment straight to CAPTURED", async () => {
      seedPendingPayment(payments);

      const result = await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));

      expect(result.outcome).toBe("captured");
      expect(gateway.captureCalls).toEqual(["pi_123"]);

      const stored = await payments.findById("payment-1");
      expect(stored?.status).toBe("CAPTURED");
      expect(stored?.capturedAt).toBeInstanceOf(Date);
    });

    it("publishes exactly one PaymentCaptured domain event", async () => {
      seedPendingPayment(payments);

      await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));

      const captured = eventBus.published.filter((e) => e instanceof PaymentCaptured);
      expect(captured).toHaveLength(1);
      expect((captured[0] as PaymentCaptured).paymentId).toBe("payment-1");
      expect((captured[0] as PaymentCaptured).amount).toBe(100);
    });

    it("acknowledges (never throws) an event for a PaymentIntent this platform doesn't know about", async () => {
      const result = await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));
      expect(result.outcome).toBe("unmatched");
      expect(gateway.captureCalls).toHaveLength(0);
    });

    it("never re-captures a Payment that is already CAPTURED", async () => {
      seedPendingPayment(payments, { status: "CAPTURED", capturedAt: new Date() });

      const result = await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));

      expect(result.outcome).toBe("already-settled");
      expect(gateway.captureCalls).toHaveLength(0);
    });
  });

  describe("payment_intent.succeeded", () => {
    it("is a no-op when the Payment is already CAPTURED (idempotent backstop, not the primary trigger)", async () => {
      seedPendingPayment(payments, { status: "CAPTURED", capturedAt: new Date() });

      const result = await useCase.execute(paymentIntentEvent("payment_intent.succeeded"));

      expect(result.outcome).toBe("already-settled");
      expect(eventBus.published).toHaveLength(0);
    });

    it("still captures the Payment if amount_capturable_updated was somehow missed", async () => {
      seedPendingPayment(payments);

      const result = await useCase.execute(paymentIntentEvent("payment_intent.succeeded"));

      expect(result.outcome).toBe("captured");
      const captured = eventBus.published.filter((e) => e instanceof PaymentCaptured);
      expect(captured).toHaveLength(1);
    });
  });

  describe("payment_intent.payment_failed", () => {
    it("marks the Payment FAILED with the decline message", async () => {
      seedPendingPayment(payments);

      const result = await useCase.execute(
        paymentIntentEvent("payment_intent.payment_failed", {
          paymentIntent: { paymentIntentId: "pi_123", lastPaymentErrorMessage: "Your card was declined." },
        }),
      );

      expect(result.outcome).toBe("failed");
      const stored = await payments.findById("payment-1");
      expect(stored?.status).toBe("FAILED");
      expect(stored?.failureReason).toBe("Your card was declined.");
    });

    it("never transitions an already-CAPTURED payment to FAILED", async () => {
      seedPendingPayment(payments, { status: "CAPTURED", capturedAt: new Date() });

      const result = await useCase.execute(paymentIntentEvent("payment_intent.payment_failed"));

      expect(result.outcome).toBe("already-settled");
      const stored = await payments.findById("payment-1");
      expect(stored?.status).toBe("CAPTURED");
    });
  });

  describe("payment_intent.canceled", () => {
    it("marks the Payment CANCELLED", async () => {
      seedPendingPayment(payments);

      const result = await useCase.execute(paymentIntentEvent("payment_intent.canceled"));

      expect(result.outcome).toBe("cancelled");
      const stored = await payments.findById("payment-1");
      expect(stored?.status).toBe("CANCELLED");
    });
  });

  describe("charge.refunded", () => {
    it("acknowledges the event without mutating the Payment — Module 77's job", async () => {
      seedPendingPayment(payments, { status: "CAPTURED", capturedAt: new Date() });

      const result = await useCase.execute(
        paymentIntentEvent("charge.refunded", {
          paymentIntent: null,
          chargeRefunded: { chargeId: "ch_1", paymentIntentId: "pi_123", amountRefunded: 20 },
        }),
      );

      expect(result.outcome).toBe("refund-observed");
      const stored = await payments.findById("payment-1");
      expect(stored?.status).toBe("CAPTURED");
    });
  });

  describe("unrecognized event types", () => {
    it("acknowledges without error", async () => {
      const result = await useCase.execute(paymentIntentEvent("customer.created", { paymentIntent: null }));
      expect(result.outcome).toBe("ignored");
    });
  });

  describe("idempotency / duplicate delivery", () => {
    it("processes a duplicate delivery of the same event id as a no-op", async () => {
      seedPendingPayment(payments);

      const first = await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));
      const second = await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));

      expect(first.outcome).toBe("captured");
      expect(second.outcome).toBe("duplicate");
      expect(gateway.captureCalls).toHaveLength(1);
      expect(eventBus.published.filter((e) => e instanceof PaymentCaptured)).toHaveLength(1);
    });

    it("claims events under a provider key distinct from Module 72's Connect webhook stream", async () => {
      seedPendingPayment(payments);
      await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));

      const claimed = [...webhookEvents.events.values()][0]!;
      expect(claimed.provider).toBe(STRIPE_PAYMENTS_WEBHOOK_PROVIDER);
      expect(claimed.provider).not.toBe("STRIPE");
    });

    it("two concurrent deliveries of two different capture-triggering events only capture and publish once", async () => {
      seedPendingPayment(payments);

      const [a, b] = await Promise.all([
        useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated", { id: "evt_a" })),
        useCase.execute(paymentIntentEvent("payment_intent.succeeded", { id: "evt_b" })),
      ]);

      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(["already-settled", "captured"]);
      expect(eventBus.published.filter((e) => e instanceof PaymentCaptured)).toHaveLength(1);
    });

    it("leaves a failed processing attempt re-claimable by a later delivery", async () => {
      const payment = seedPendingPayment(payments);
      gateway.nextError = new Error("Stripe momentarily unreachable");

      await expect(useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"))).rejects.toThrow();

      const claimed = [...webhookEvents.events.values()][0]!;
      expect(claimed.status).toBe("FAILED");

      gateway.nextError = null;
      const retry = await useCase.execute(paymentIntentEvent("payment_intent.amount_capturable_updated"));
      expect(retry.outcome).toBe("captured");
      expect((await payments.findById(payment.id))?.status).toBe("CAPTURED");
    });
  });
});
