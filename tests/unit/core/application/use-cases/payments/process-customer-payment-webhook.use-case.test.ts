import { beforeEach, describe, expect, it } from "vitest";

import { PaymentCaptured } from "@/domain/events/payment-captured";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import {
  STRIPE_PAYMENTS_WEBHOOK_PROVIDER,
  ProcessCustomerPaymentWebhookUseCase,
} from "@/application/use-cases/payments/process-customer-payment-webhook.use-case";
import {
  FakeEventBus,
  FakeExternalWebhookEventRepository,
  FakeFinancialLedgerRepository,
  FakePaymentGateway,
  FakePaymentRepository,
} from "./fakes";
import { NullFailureReporter } from "@/application/ports/failure-reporter";
import { FakeRefundRepository } from "../refunds/fakes";

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
    dispute: null,
    chargeUpdated: null,
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
    it("acknowledges the event without mutating the Payment directly — ExecuteRefundUseCase (Module 77) is the one place that ever does", async () => {
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

    describe("Module 77 reconciliation (RefundRepository wired)", () => {
      let refunds: FakeRefundRepository;
      let useCaseWithRefunds: ProcessCustomerPaymentWebhookUseCase;

      beforeEach(() => {
        refunds = new FakeRefundRepository();
        useCaseWithRefunds = new ProcessCustomerPaymentWebhookUseCase(
          payments,
          gateway,
          webhookEvents,
          eventBus,
          new NullFailureReporter(),
          refunds,
        );
      });

      it("reconciles a Refund this platform itself created — no state change when it's already PROCESSED", async () => {
        seedPendingPayment(payments, { status: "REFUNDED", capturedAt: new Date() });
        await refunds.createPending({
          paymentId: "payment-1",
          requestedByUserId: "admin-1",
          amount: 100,
          financialAdjustmentId: "adj-1",
          idempotencyKey: "refund:adj-1",
          notes: null,
        });
        const created = await refunds.findByFinancialAdjustmentId("adj-1");
        await refunds.markProcessed({ id: created!.id, stripeRefundId: "re_1", fromStatuses: ["REQUESTED"] });

        const result = await useCaseWithRefunds.execute(
          paymentIntentEvent("charge.refunded", {
            paymentIntent: null,
            chargeRefunded: { chargeId: "ch_1", paymentIntentId: "pi_123", amountRefunded: 100, refundId: "re_1", status: "succeeded" },
          }),
        );

        expect(result.outcome).toBe("refund-observed");
        const refund = await refunds.findByStripeRefundId("re_1");
        expect(refund?.status).toBe("PROCESSED");
      });

      it("reconciles a Refund whose Stripe status resolved asynchronously (REQUESTED -> PROCESSED)", async () => {
        seedPendingPayment(payments, { status: "PARTIALLY_REFUNDED", capturedAt: new Date() });
        await refunds.createPending({
          paymentId: "payment-1",
          requestedByUserId: "admin-1",
          amount: 20,
          financialAdjustmentId: "adj-1",
          idempotencyKey: "refund:adj-1",
          notes: null,
        });
        const created = await refunds.findByFinancialAdjustmentId("adj-1");
        // Simulate the row already carrying the Stripe refund id (set by
        // ExecuteRefundUseCase's own call) but not yet reconciled as
        // PROCESSED — the fake normally sets both together, so this
        // directly exercises the reconciliation branch.
        refunds.byId.set(created!.id, { ...created!, stripeRefundId: "re_2" });

        await useCaseWithRefunds.execute(
          paymentIntentEvent("charge.refunded", {
            paymentIntent: null,
            chargeRefunded: { chargeId: "ch_1", paymentIntentId: "pi_123", amountRefunded: 20, refundId: "re_2", status: "succeeded" },
          }),
        );

        const refund = await refunds.findByStripeRefundId("re_2");
        expect(refund?.status).toBe("PROCESSED");
      });

      it("logs (never throws) for a Stripe refund id with no matching internal Refund row", async () => {
        seedPendingPayment(payments, { status: "CAPTURED", capturedAt: new Date() });

        const result = await useCaseWithRefunds.execute(
          paymentIntentEvent("charge.refunded", {
            paymentIntent: null,
            chargeRefunded: { chargeId: "ch_1", paymentIntentId: "pi_123", amountRefunded: 20, refundId: "re_unmatched", status: "succeeded" },
          }),
        );

        expect(result.outcome).toBe("refund-observed");
      });
    });

    describe("duplicate charge.refunded delivery", () => {
      it("a second delivery of the same event id is a pure no-op", async () => {
        seedPendingPayment(payments, { status: "REFUNDED", capturedAt: new Date() });
        const event = paymentIntentEvent("charge.refunded", {
          paymentIntent: null,
          chargeRefunded: { chargeId: "ch_1", paymentIntentId: "pi_123", amountRefunded: 100, refundId: "re_1", status: "succeeded" },
        });

        const first = await useCase.execute(event);
        const second = await useCase.execute(event);

        expect(first.outcome).toBe("refund-observed");
        expect(second.outcome).toBe("duplicate");
      });
    });
  });

  describe("charge.updated — Module 96 Stripe fee capture", () => {
    function chargeUpdatedEvent(
      overrides: { balanceTransactionId?: string | null; paymentIntentId?: string | null; id?: string } = {},
    ) {
      return {
        id: overrides.id ?? "evt_charge_updated_1",
        type: "charge.updated",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        paymentIntent: null,
        chargeRefunded: null,
        dispute: null,
        chargeUpdated: {
          chargeId: "ch_1",
          paymentIntentId: overrides.paymentIntentId === undefined ? "pi_123" : overrides.paymentIntentId,
          balanceTransactionId: overrides.balanceTransactionId === undefined ? "txn_1" : overrides.balanceTransactionId,
        },
      };
    }

    it("captures the real Stripe fee and records it as a negative STRIPE_FEE ledger entry", async () => {
      const payment = seedPendingPayment(payments, { status: "CAPTURED" });
      const ledger = new FakeFinancialLedgerRepository();
      gateway.balanceTransactionFees.set("txn_1", { feeAmount: 15, currency: "EUR" });
      const useCaseWithLedger = new ProcessCustomerPaymentWebhookUseCase(
        payments,
        gateway,
        webhookEvents,
        eventBus,
        undefined,
        null,
        null,
        ledger,
      );

      const result = await useCaseWithLedger.execute(chargeUpdatedEvent());

      expect(result.outcome).toBe("fee-captured");
      expect(result.paymentId).toBe(payment.id);
      expect(ledger.entries).toHaveLength(1);
      expect(ledger.entries[0]!.type).toBe("STRIPE_FEE");
      expect(ledger.entries[0]!.amount).toBe(-15);
      expect(ledger.entries[0]!.paymentId).toBe(payment.id);
      expect(ledger.entries[0]!.idempotencyKey).toBe(`stripe-fee:${payment.id}`);
    });

    it("is a no-op without a wired ledger (null feeLedger — pre-Module-96 callers keep compiling/behaving unchanged)", async () => {
      seedPendingPayment(payments, { status: "CAPTURED" });
      const result = await useCase.execute(chargeUpdatedEvent());
      expect(result.outcome).toBe("ignored");
    });

    it("ignores a charge.updated delivery with no balance_transaction yet", async () => {
      const ledger = new FakeFinancialLedgerRepository();
      const useCaseWithLedger = new ProcessCustomerPaymentWebhookUseCase(
        payments,
        gateway,
        webhookEvents,
        eventBus,
        undefined,
        null,
        null,
        ledger,
      );
      seedPendingPayment(payments, { status: "CAPTURED" });

      const result = await useCaseWithLedger.execute(chargeUpdatedEvent({ balanceTransactionId: null }));

      expect(result.outcome).toBe("ignored");
      expect(ledger.entries).toHaveLength(0);
    });

    it("never records the fee twice — a second charge.updated for an already-recorded payment is a pure no-op", async () => {
      const payment = seedPendingPayment(payments, { status: "CAPTURED" });
      const ledger = new FakeFinancialLedgerRepository();
      gateway.balanceTransactionFees.set("txn_1", { feeAmount: 15, currency: "EUR" });
      const useCaseWithLedger = new ProcessCustomerPaymentWebhookUseCase(
        payments,
        gateway,
        webhookEvents,
        eventBus,
        undefined,
        null,
        null,
        ledger,
      );

      const first = await useCaseWithLedger.execute(chargeUpdatedEvent());
      expect(first.outcome).toBe("fee-captured");

      // A second, independently-delivered charge.updated event (a
      // DIFFERENT Stripe event id, so webhookEvents.claim()'s per-event-id
      // dedupe does not catch this — Stripe's own docs note
      // charge.updated can fire more than once as fields settle) for the
      // same payment must still never create a second STRIPE_FEE row —
      // this is the handler's own idempotencyKey pre-check being
      // exercised, not the outer claim() layer (covered separately).
      const second = await useCaseWithLedger.execute(chargeUpdatedEvent({ id: "evt_charge_updated_2" }));

      expect(second.outcome).toBe("already-settled");
      expect(second.paymentId).toBe(payment.id);
      expect(ledger.entries).toHaveLength(1);
    });

    it("reports unmatched for a paymentIntentId with no corresponding Payment", async () => {
      const ledger = new FakeFinancialLedgerRepository();
      const useCaseWithLedger = new ProcessCustomerPaymentWebhookUseCase(
        payments,
        gateway,
        webhookEvents,
        eventBus,
        undefined,
        null,
        null,
        ledger,
      );

      const result = await useCaseWithLedger.execute(chargeUpdatedEvent({ paymentIntentId: "pi_unknown" }));

      expect(result.outcome).toBe("unmatched");
      expect(ledger.entries).toHaveLength(0);
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

  describe("charge.dispute.* dispatch (Module 86)", () => {
    it("is ignored (never crashes) when no StripeDisputeWebhookHandler is injected", async () => {
      const result = await useCase.execute(
        paymentIntentEvent("charge.dispute.created", {
          paymentIntent: null,
          dispute: { disputeId: "dp_1", chargeId: "ch_1", paymentIntentId: "pi_123", amount: 100, currency: "EUR", reason: null, status: "needs_response", evidenceDueBy: null },
        }),
      );
      expect(result.outcome).toBe("ignored");
    });

    it("delegates each of the three handled dispute event types to the injected handler with the extracted payload", async () => {
      const calls: Array<{ eventType: string; disputeId: string }> = [];
      const handler = {
        handle: async (eventType: string, payload: { disputeId: string }) => {
          calls.push({ eventType, disputeId: payload.disputeId });
        },
      };
      const useCaseWithDisputes = new ProcessCustomerPaymentWebhookUseCase(
        payments,
        gateway,
        webhookEvents,
        eventBus,
        undefined,
        undefined,
        handler,
      );

      for (const type of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) {
        const result = await useCaseWithDisputes.execute(
          paymentIntentEvent(type, {
            id: `evt_${type}`,
            paymentIntent: null,
            dispute: { disputeId: "dp_1", chargeId: "ch_1", paymentIntentId: "pi_123", amount: 100, currency: "EUR", reason: null, status: "needs_response", evidenceDueBy: null },
          }),
        );
        expect(result.outcome).toBe("dispute-processed");
      }

      expect(calls).toEqual([
        { eventType: "charge.dispute.created", disputeId: "dp_1" },
        { eventType: "charge.dispute.updated", disputeId: "dp_1" },
        { eventType: "charge.dispute.closed", disputeId: "dp_1" },
      ]);
    });
  });
});
