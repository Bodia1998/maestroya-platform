import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { PaymentGatewayError } from "@/domain/errors/domain-error";
import { StripeLeadFeePaymentGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway";

/** Module 153 — refund capabilities of the adapter, against a hand-built fake Stripe SDK (no network, no credentials). */
function fakeStripe() {
  const charge = { id: "ch_1", amount_refunded: 0, refunded: false, disputed: false };
  const intent = { id: "pi_1", status: "succeeded", amount: 2178, amount_received: 2178, currency: "eur", metadata: { leadPurchaseId: "purchase-1" }, latest_charge: charge };
  const refund = { id: "re_1", status: "succeeded", amount: 2178, currency: "eur", payment_intent: "pi_1", metadata: { leadFeeRefundId: "rec-1" } };
  const paymentIntents = { create: vi.fn(), retrieve: vi.fn(async () => ({ ...intent })), cancel: vi.fn() };
  const refunds = { create: vi.fn(async () => ({ ...refund })), list: vi.fn(async () => ({ data: [{ ...refund }], has_more: false })) };
  return { stripe: { paymentIntents, refunds } as unknown as Stripe, paymentIntents, refunds, charge, intent, refund };
}
const REQUEST = { refundRecordId: "rec-1", leadPurchaseId: "purchase-1", paymentReference: "pi_1", amountMinorUnits: 2178, currency: "EUR", idempotencyKey: "lead-fee-refund:pi_1:1" };

describe("StripeLeadFeePaymentGatewayAdapter refunds (Module 153)", () => {
  it("creates a FULL refund of the payment with only opaque ids in metadata and the attempt's idempotency key", async () => {
    const { stripe, refunds } = fakeStripe();
    const result = await new StripeLeadFeePaymentGatewayAdapter(stripe).createRefund(REQUEST);
    const [params, options] = refunds.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toEqual({
      payment_intent: "pi_1",
      amount: 2178,
      metadata: { flow: "LEAD_V1", purpose: "lead_fee_refund", leadFeeRefundId: "rec-1", leadPurchaseId: "purchase-1" },
    });
    expect(options).toEqual({ idempotencyKey: "lead-fee-refund:pi_1:1" });
    for (const forbidden of ["reverse_transfer", "refund_application_fee", "charge", "reason"]) expect(params).not.toHaveProperty(forbidden);
    expect(result).toEqual({ reference: "re_1", paymentReference: "pi_1", status: "SUCCEEDED", amountMinorUnits: 2178, currency: "EUR", refundRecordId: "rec-1" });
  });

  it.each([0, -1, 12.5, Number.NaN])("refuses an invalid amount (%s) without calling Stripe", async (amount) => {
    const { stripe, refunds } = fakeStripe();
    await expect(new StripeLeadFeePaymentGatewayAdapter(stripe).createRefund({ ...REQUEST, amountMinorUnits: amount })).rejects.toBeInstanceOf(PaymentGatewayError);
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it.each([
    ["succeeded", "SUCCEEDED"],
    ["pending", "PENDING"],
    ["requires_action", "PENDING"],
    ["failed", "FAILED"],
    ["canceled", "CANCELED"],
    ["something_new", "UNRECOGNIZED"],
    [null, "UNRECOGNIZED"],
  ])("maps refund status %s -> %s (unknown never becomes success)", async (stripeStatus, expected) => {
    const { stripe, refunds, refund } = fakeStripe();
    refunds.list.mockResolvedValueOnce({ data: [{ ...refund, status: stripeStatus }], has_more: false } as never);
    expect((await new StripeLeadFeePaymentGatewayAdapter(stripe).listRefunds("pi_1"))[0]!.status).toBe(expected);
  });

  it("reports a refund without our record id as foreign (refundRecordId null)", async () => {
    const { stripe, refunds, refund } = fakeStripe();
    refunds.list.mockResolvedValueOnce({ data: [{ ...refund, metadata: {} }], has_more: false } as never);
    expect((await new StripeLeadFeePaymentGatewayAdapter(stripe).listRefunds("pi_1"))[0]!.refundRecordId).toBeNull();
  });

  it("lists by payment, follows pagination, and fails closed when the listing cannot be read completely", async () => {
    const { stripe, refunds, refund } = fakeStripe();
    refunds.list.mockResolvedValueOnce({ data: [{ ...refund, id: "re_a" }], has_more: true } as never).mockResolvedValueOnce({ data: [{ ...refund, id: "re_b" }], has_more: false } as never);
    const all = await new StripeLeadFeePaymentGatewayAdapter(stripe).listRefunds("pi_1");
    expect(all.map((r) => r.reference)).toEqual(["re_a", "re_b"]);
    expect(refunds.list).toHaveBeenNthCalledWith(1, { payment_intent: "pi_1", limit: 100 });
    expect(refunds.list).toHaveBeenNthCalledWith(2, { payment_intent: "pi_1", limit: 100, starting_after: "re_a" });

    refunds.list.mockReset();
    refunds.list.mockResolvedValue({ data: [{ ...refund }], has_more: true } as never);
    await expect(new StripeLeadFeePaymentGatewayAdapter(stripe).listRefunds("pi_1")).rejects.toBeInstanceOf(PaymentGatewayError);
  });

  it("reads the payment facts from the expanded latest charge; an unreadable charge fails closed", async () => {
    const { stripe, paymentIntents, charge, intent } = fakeStripe();
    const adapter = new StripeLeadFeePaymentGatewayAdapter(stripe);
    charge.amount_refunded = 500;
    charge.disputed = true;
    expect(await adapter.retrievePaymentFacts("pi_1")).toEqual({
      reference: "pi_1",
      status: "SUCCEEDED",
      amountMinorUnits: 2178,
      amountReceivedMinorUnits: 2178,
      amountRefundedMinorUnits: 500,
      refunded: false,
      disputed: true,
      currency: "EUR",
      purchaseId: "purchase-1",
    });
    expect(paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", { expand: ["latest_charge"] });
    paymentIntents.retrieve.mockResolvedValueOnce({ ...intent, latest_charge: "ch_1" } as never);
    await expect(adapter.retrievePaymentFacts("pi_1")).rejects.toBeInstanceOf(PaymentGatewayError);
    paymentIntents.retrieve.mockResolvedValueOnce({ ...intent, latest_charge: null } as never);
    await expect(adapter.retrievePaymentFacts("pi_1")).rejects.toBeInstanceOf(PaymentGatewayError);
  });

  it("maps SDK errors onto PaymentGatewayError categories (a timeout is NETWORK, not a definitive rejection)", async () => {
    const { stripe, refunds } = fakeStripe();
    refunds.create.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "down", type: "api_error" } as never));
    expect(await new StripeLeadFeePaymentGatewayAdapter(stripe).createRefund(REQUEST).catch((e: unknown) => e)).toMatchObject({ category: "NETWORK" });
    refunds.create.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: "bad", type: "invalid_request_error" } as never));
    expect(await new StripeLeadFeePaymentGatewayAdapter(stripe).createRefund(REQUEST).catch((e: unknown) => e)).toMatchObject({ category: "INVALID_REQUEST" });
  });
});
