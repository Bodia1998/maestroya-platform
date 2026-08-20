import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { StripeTransferError } from "@/domain/errors/domain-error";
import { StripeTransferGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-transfer-gateway";

/**
 * Module 77 — Refund & Dispute Financial Execution: unit tests for the one
 * method this module adds to `StripeTransferGatewayAdapter`
 * (`reverseTransfer`) — `createTransfer` itself is already covered by
 * Module 76's own regression suite and is left untouched here.
 */
function fakeStripe(overrides: Partial<Stripe> = {}): Stripe {
  return {
    transfers: {
      create: vi.fn(),
      createReversal: vi.fn(),
    },
    ...overrides,
  } as unknown as Stripe;
}

describe("StripeTransferGatewayAdapter.reverseTransfer (Module 77)", () => {
  it("calls stripe.transfers.createReversal with the amount converted to integer cents and the given idempotency key", async () => {
    const stripe = fakeStripe();
    (stripe.transfers.createReversal as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "trr_123" });
    const adapter = new StripeTransferGatewayAdapter(stripe);

    const result = await adapter.reverseTransfer({
      stripeTransferId: "tr_123",
      amount: 90,
      currency: "EUR",
      idempotencyKey: "payout-reversal:payout-1",
      metadata: { payoutId: "payout-1" },
    });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_123",
      { amount: 9000, metadata: { payoutId: "payout-1" } },
      { idempotencyKey: "payout-reversal:payout-1" },
    );
    expect(result).toEqual({ stripeReversalId: "trr_123" });
  });

  it("maps balance_insufficient onto INSUFFICIENT_BALANCE, never swallowing the error", async () => {
    const stripe = fakeStripe();
    (stripe.transfers.createReversal as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({ message: "Insufficient balance.", type: "invalid_request_error", code: "balance_insufficient" } as never),
    );
    const adapter = new StripeTransferGatewayAdapter(stripe);

    await expect(
      adapter.reverseTransfer({
        stripeTransferId: "tr_123",
        amount: 90,
        currency: "EUR",
        idempotencyKey: "payout-reversal:payout-1",
        metadata: { payoutId: "payout-1" },
      }),
    ).rejects.toMatchObject({ category: "INSUFFICIENT_BALANCE" });
  });

  it("maps a generic Stripe error onto StripeTransferError", async () => {
    const stripe = fakeStripe();
    (stripe.transfers.createReversal as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const adapter = new StripeTransferGatewayAdapter(stripe);

    await expect(
      adapter.reverseTransfer({
        stripeTransferId: "tr_123",
        amount: 90,
        currency: "EUR",
        idempotencyKey: "payout-reversal:payout-1",
        metadata: { payoutId: "payout-1" },
      }),
    ).rejects.toBeInstanceOf(StripeTransferError);
  });
});
