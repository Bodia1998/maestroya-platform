import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 141 — routing at `POST /api/webhooks/stripe-payments`: LEAD_V1 events go to the lead-fee
 * use case ONLY; everything else stays on the (unchanged) legacy use case; nothing is processed
 * before the signature check; responses carry no sensitive data.
 */
const legacyExecute = vi.fn();
const leadFeeExecute = vi.fn();
const mockVerify = vi.fn();

vi.mock("@/application/use-cases/payments/compose", () => ({
  getStripePaymentWebhookVerifierInstance: () => ({ verify: mockVerify }),
  makeProcessCustomerPaymentWebhookUseCase: () => ({ execute: legacyExecute }),
}));
vi.mock("@/application/use-cases/lead-fee-payment/compose", () => ({
  makeProcessLeadFeePaymentWebhookUseCase: () => ({ execute: leadFeeExecute }),
}));
vi.mock("@/application/use-cases/affiliate/compose", () => ({
  reconcileAffiliateCommissionStripeFeeForPayment: vi.fn(),
}));

const { POST } = await import("../../../../../src/app/api/webhooks/stripe-payments/route");

const req = (sig: string | null = "t=1,v1=abc") => {
  const headers = new Headers({ "content-type": "application/json" });
  if (sig) headers.set("stripe-signature", sig);
  return new NextRequest("http://localhost:3000/api/webhooks/stripe-payments", { method: "POST", body: "{}", headers });
};
const event = (flow: string | null, type = "payment_intent.succeeded") => ({
  id: "evt_1",
  type,
  createdAt: new Date(),
  paymentIntent: { paymentIntentId: "pi_1", lastPaymentErrorMessage: null, amountMinorUnits: 12100, currency: "eur", flow, leadPurchaseId: "p", leadId: "l" },
  chargeRefunded: null,
  dispute: null,
  chargeUpdated: null,
});

describe("M141 route — signature + routing", () => {
  beforeEach(() => {
    legacyExecute.mockReset();
    leadFeeExecute.mockReset();
    mockVerify.mockReset();
  });

  it.each([["invalid", "t=1,v1=bad"], ["missing", null]])("%s signature -> 401 and NEITHER use case runs", async (_n, sig) => {
    mockVerify.mockReturnValue({ valid: false });
    const res = await POST(req(sig));
    expect(res.status).toBe(401);
    expect(leadFeeExecute).not.toHaveBeenCalled();
    expect(legacyExecute).not.toHaveBeenCalled();
  });

  it("LEAD_V1 event -> lead-fee use case with the verified event; legacy never runs", async () => {
    const e = event("LEAD_V1");
    mockVerify.mockReturnValue({ valid: true, event: e });
    leadFeeExecute.mockResolvedValue({ outcome: "confirmed" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(leadFeeExecute).toHaveBeenCalledWith(e);
    expect(legacyExecute).not.toHaveBeenCalled();
    expect((await res.json()).status).toBe("confirmed");
  });

  it.each([["no marker", null], ["other marker", "SOMETHING_ELSE"], ["lowercase", "lead_v1"]])(
    "%s -> legacy path, lead-fee use case never runs",
    async (_n, flow) => {
      const e = event(flow);
      mockVerify.mockReturnValue({ valid: true, event: e });
      legacyExecute.mockResolvedValue({ outcome: "captured", paymentId: "pay-1" });
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(legacyExecute).toHaveBeenCalledWith(e);
      expect(leadFeeExecute).not.toHaveBeenCalled();
    },
  );

  it("non-payment-intent legacy events (charge.refunded, no paymentIntent payload) stay legacy", async () => {
    const e = { ...event(null, "charge.refunded"), paymentIntent: null };
    mockVerify.mockReturnValue({ valid: true, event: e });
    legacyExecute.mockResolvedValue({ outcome: "refund-observed" });
    await POST(req());
    expect(legacyExecute).toHaveBeenCalledWith(e);
    expect(leadFeeExecute).not.toHaveBeenCalled();
  });

  it.each(["rejected", "unmatched", "duplicate", "already-confirmed", "payment-failed-observed", "cancelled"])(
    "business outcome %s is acknowledged with 200 (no provider retry)",
    async (outcome) => {
      mockVerify.mockReturnValue({ valid: true, event: event("LEAD_V1") });
      leadFeeExecute.mockResolvedValue({ outcome, rejection: "AMOUNT_MISMATCH" });
      const res = await POST(req());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["requestId", "status"]);
      expect(JSON.stringify(body)).not.toContain("AMOUNT_MISMATCH");
    },
  );

  it("response never contains contact, amount, reference or secrets", async () => {
    mockVerify.mockReturnValue({ valid: true, event: event("LEAD_V1") });
    leadFeeExecute.mockResolvedValue({ outcome: "confirmed" });
    const text = await (await POST(req())).text();
    for (const forbidden of ["pi_1", "12100", "@", "client_secret", "whsec", "email", "phone", "address"]) expect(text).not.toContain(forbidden);
  });

  it("an unexpected lead-fee failure is a generic 500 (provider retries), never a stack trace", async () => {
    mockVerify.mockReturnValue({ valid: true, event: event("LEAD_V1") });
    leadFeeExecute.mockRejectedValue(new Error("db is down"));
    const res = await POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(legacyExecute).not.toHaveBeenCalled();
  });
});
