import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 141 — legacy regression: adding the LEAD_V1 branch must not change what the legacy
 * customer-payment webhook does. Every legacy event shape (including a PaymentIntent whose
 * metadata is attacker-looking or merely different) is handled by the legacy use case exactly as
 * before, the legacy post-processing (charge.updated -> affiliate fee reconciliation) still runs,
 * and the lead-fee use case is never reached.
 */
const legacyExecute = vi.fn();
const leadFeeExecute = vi.fn();
const reconcile = vi.fn();
const mockVerify = vi.fn();

vi.mock("@/application/use-cases/payments/compose", () => ({
  getStripePaymentWebhookVerifierInstance: () => ({ verify: mockVerify }),
  makeProcessCustomerPaymentWebhookUseCase: () => ({ execute: legacyExecute }),
}));
vi.mock("@/application/use-cases/lead-fee-payment/compose", () => ({
  makeProcessLeadFeePaymentWebhookUseCase: () => ({ execute: leadFeeExecute }),
}));
vi.mock("@/application/use-cases/affiliate/compose", () => ({
  reconcileAffiliateCommissionStripeFeeForPayment: (...args: unknown[]) => reconcile(...args),
}));

const { POST } = await import("../../../../../src/app/api/webhooks/stripe-payments/route");

const request = () =>
  new NextRequest("http://localhost:3000/api/webhooks/stripe-payments", {
    method: "POST",
    body: "{}",
    headers: new Headers({ "stripe-signature": "t=1,v1=abc" }),
  });

const legacyIntent = (type: string, flow?: string | null) => ({
  id: `evt_${type}`,
  type,
  createdAt: new Date(),
  paymentIntent: { paymentIntentId: "pi_legacy", lastPaymentErrorMessage: null, ...(flow === undefined ? {} : { flow }) },
  chargeRefunded: null,
  dispute: null,
  chargeUpdated: null,
});

describe("M141 — legacy webhook behaviour is unchanged", () => {
  beforeEach(() => {
    legacyExecute.mockReset();
    leadFeeExecute.mockReset();
    reconcile.mockReset();
    mockVerify.mockReset();
  });

  it.each([
    ["payment_intent.amount_capturable_updated", "captured"],
    ["payment_intent.succeeded", "already-settled"],
    ["payment_intent.payment_failed", "failed"],
    ["payment_intent.canceled", "cancelled"],
  ])("legacy %s (payload without any M141 field) -> legacy use case, outcome %s", async (type, outcome) => {
    const event = legacyIntent(type);
    mockVerify.mockReturnValue({ valid: true, event });
    legacyExecute.mockResolvedValue({ outcome, paymentId: "pay-1" });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: outcome });
    expect(legacyExecute).toHaveBeenCalledWith(event);
    expect(leadFeeExecute).not.toHaveBeenCalled();
  });

  it("a legacy intent with a different metadata flow marker still goes to the legacy path", async () => {
    const event = legacyIntent("payment_intent.succeeded", "LEGACY_QUOTE_PAYMENT");
    mockVerify.mockReturnValue({ valid: true, event });
    legacyExecute.mockResolvedValue({ outcome: "unmatched" });
    await POST(request());
    expect(legacyExecute).toHaveBeenCalledWith(event);
    expect(leadFeeExecute).not.toHaveBeenCalled();
  });

  it("charge.updated still triggers the legacy affiliate fee reconciliation", async () => {
    const event = { ...legacyIntent("charge.updated"), paymentIntent: null };
    mockVerify.mockReturnValue({ valid: true, event });
    legacyExecute.mockResolvedValue({ outcome: "fee-captured", paymentId: "pay-1" });
    await POST(request());
    expect(reconcile).toHaveBeenCalledWith("pay-1");
    expect(leadFeeExecute).not.toHaveBeenCalled();
  });

  it("a LEAD_V1 event never reaches the legacy use case nor the legacy fee reconciliation", async () => {
    mockVerify.mockReturnValue({ valid: true, event: legacyIntent("payment_intent.succeeded", "LEAD_V1") });
    leadFeeExecute.mockResolvedValue({ outcome: "confirmed" });
    await POST(request());
    expect(legacyExecute).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
