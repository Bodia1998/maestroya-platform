import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadContactDTO } from "@/application/dto/lead-contact.dto";
import type { LeadPurchaseCheckoutDTO } from "@/application/dto/lead-purchase-checkout.dto";

import { M139_SECRET_EMAIL, M139_SENTINELS } from "../../test-utils/contact-leak-sentinels";

/**
 * Module 144 — the checkout component renders/orchestrates ONLY what the (mocked) existing
 * boundaries return: M126/M135 start, M140 payment initiation, the authoritative status read
 * and the M138 contact action. Stripe Elements is mocked (no network, no secret key).
 */
const startAction = vi.fn();
const statusAction = vi.fn();
const paymentAction = vi.fn();
const contactAction = vi.fn();
const stripe = vi.hoisted(() => ({ confirmPayment: vi.fn(), loadStripe: vi.fn() }));

vi.mock("@/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase/actions", () => ({
  startLeadPurchaseAction: (...a: unknown[]) => startAction(...a),
  getLeadPurchaseCheckoutAction: (...a: unknown[]) => statusAction(...a),
}));
vi.mock("@/app/(dashboard)/dashboard/professional/leads/payment-actions", () => ({ initiateLeadFeePaymentAction: (...a: unknown[]) => paymentAction(...a) }));
vi.mock("@/app/(dashboard)/dashboard/professional/leads/actions", () => ({ getLeadContactAction: (...a: unknown[]) => contactAction(...a) }));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: (...a: unknown[]) => stripe.loadStripe(...a) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => <div data-testid="elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: stripe.confirmPayment }),
  useElements: () => ({}),
}));

const { PurchaseCheckout } = await import("../../../src/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase/purchase-checkout");
const { LEAD_PURCHASE_POLL_INTERVALS_MS } = await import("../../../src/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase/checkout-view");

const LEAD = "11111111-1111-4111-8111-111111111111";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const SECRET = "pi_3SECRET_secret_CLIENT";

const lead = { title: "Leaking tap", description: "Dripping for two days", categoryLabel: "Plumbing", urgency: "MEDIUM" as const, city: "Madrid", province: null };
const purchase = (status: string, patch: Partial<LeadPurchaseCheckoutDTO> = {}): LeadPurchaseCheckoutDTO =>
  ({ purchaseId: PURCHASE, leadId: LEAD, status, feeAmount: "100.00", taxAmount: "21.00", totalAmount: "121.00", currency: "EUR", ...patch }) as LeadPurchaseCheckoutDTO;

const payment = (patch: Record<string, unknown> = {}) => ({
  success: true,
  payment: { purchaseId: PURCHASE, purchaseStatus: "PENDING_PAYMENT", clientSecret: SECRET, totalAmount: "121.00", currency: "EUR", paymentStatus: "REQUIRES_PAYMENT_METHOD", ...patch },
});

const CONTACT: LeadContactDTO = {
  leadId: LEAD,
  customerDisplayName: "M139 Secret Customer Name",
  email: M139_SECRET_EMAIL,
  phone: "+34600009999",
  address: { line1: "M139_SECRET_ADDRESS", line2: null, postalCode: "M139-99999", city: "Madrid", province: "Madrid" },
};

function mount(initialPurchase: LeadPurchaseCheckoutDTO | null | undefined, props: { lead?: typeof lead | null } = {}) {
  return render(
    <PurchaseCheckout
      leadId={LEAD}
      initialPurchase={initialPurchase}
      lead={props.lead === undefined ? lead : props.lead}
      stripePublishableKey="pk_test_placeholder"
      marketplaceHref="/dashboard/professional/leads"
    />,
  );
}

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const hasContact = () => M139_SENTINELS.some((s) => document.body.innerHTML.includes(s));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  stripe.loadStripe.mockResolvedValue({});
  stripe.confirmPayment.mockResolvedValue({});
  contactAction.mockResolvedValue({ success: true, contact: CONTACT });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("M144 checkout — starting a purchase and paying", () => {
  it("shows the lead summary and no price/payment/contact before the purchase is started", async () => {
    mount(null);
    expect(screen.getByRole("heading", { level: 2, name: "Ready to purchase" })).toBeInTheDocument();
    expect(screen.getByText("Leaking tap")).toBeInTheDocument();
    expect(screen.getByText(/shown as soon as you start the purchase/)).toBeInTheDocument();
    expect(screen.queryByTestId("payment-element")).toBeNull();
    expect(hasContact()).toBe(false);
    expect(startAction).not.toHaveBeenCalled();
    expect(paymentAction).not.toHaveBeenCalled();
    expect(contactAction).not.toHaveBeenCalled();
  });

  it("uses the existing start boundary, then the existing M140 action with the purchase id, then shows the payment form", async () => {
    startAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    paymentAction.mockResolvedValue(payment());
    mount(null);
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await flush();
    expect(startAction).toHaveBeenCalledTimes(1);
    expect(startAction).toHaveBeenCalledWith(LEAD);
    expect(paymentAction).toHaveBeenCalledTimes(1);
    expect(paymentAction).toHaveBeenCalledWith(PURCHASE);
    expect(screen.getByTestId("payment-element")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Payment details" })).toBeInTheDocument();
    expect(contactAction).not.toHaveBeenCalled();
    expect(hasContact()).toBe(false);
  });

  it("protects against duplicate clicks: one purchase creation and one payment initiation", async () => {
    let release: (v: unknown) => void = () => undefined;
    startAction.mockReturnValue(new Promise((resolve) => (release = resolve)));
    paymentAction.mockResolvedValue(payment());
    mount(null);
    const button = screen.getByRole("button", { name: "Continue to payment" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();
    expect(startAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
    release({ success: true, purchase: purchase("PENDING_PAYMENT") });
    await flush();
    expect(paymentAction).toHaveBeenCalledTimes(1);
  });

  it("renders the backend amounts exactly — even values no calculation would produce (no client-side tax/total maths)", async () => {
    startAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT", { feeAmount: "10.00", taxAmount: "7.77", totalAmount: "99.99", currency: "EUR" }) });
    paymentAction.mockResolvedValue(payment({ totalAmount: "99.99" }));
    mount(null);
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await flush();
    const summary = screen.getByRole("region", { name: "Order summary" });
    expect(summary).toHaveTextContent("€10.00");
    expect(summary).toHaveTextContent("€7.77");
    expect(summary).toHaveTextContent("€99.99");
    expect(summary).not.toHaveTextContent("€2.10"); // fee * 21 %
    expect(summary).not.toHaveTextContent("€89.99"); // total - fee
  });

  it("renders fee, IVA, total and currency from the backend response", async () => {
    mount(purchase("CONFIRMED", { currency: "EUR" }));
    await flush();
    const summary = screen.getByRole("region", { name: "Order summary" });
    expect(summary).toHaveTextContent("Lead fee");
    expect(summary).toHaveTextContent("€100.00");
    expect(summary).toHaveTextContent("IVA");
    expect(summary).toHaveTextContent("€21.00");
    expect(summary).toHaveTextContent("Total payable");
    expect(summary).toHaveTextContent("€121.00");
  });

  it("does not offer payment when a legacy purchase has no price breakdown", async () => {
    mount(purchase("CONFIRMED", { taxAmount: null, totalAmount: null }));
    await flush();
    expect(screen.getByText("The price breakdown for this purchase is not available.")).toBeInTheDocument();
  });

  it("resumes an existing PENDING_PAYMENT purchase through M140 only (no second purchase)", async () => {
    paymentAction.mockResolvedValue(payment());
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    expect(startAction).not.toHaveBeenCalled();
    expect(paymentAction).toHaveBeenCalledTimes(1);
    expect(paymentAction).toHaveBeenCalledWith(PURCHASE);
    expect(screen.getByTestId("payment-element")).toBeInTheDocument();
  });

  it.each(["SUCCEEDED", "PROCESSING"])("an already %s provider payment goes straight to waiting for the server (no card form)", async (paymentStatus) => {
    paymentAction.mockResolvedValue(payment({ paymentStatus, clientSecret: null }));
    statusAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Confirming your payment" })).toBeInTheDocument();
    expect(screen.queryByTestId("payment-element")).toBeNull();
    expect(contactAction).not.toHaveBeenCalled();
  });

  it("an M140 failure on a purchase the server no longer considers pending shows the server's state, not a guess", async () => {
    paymentAction.mockResolvedValue({ success: false, error: "Prisma P2002 internal detail" });
    statusAction.mockResolvedValue({ success: true, purchase: purchase("CANCELLED") });
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Purchase cancelled" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/Prisma|P2002|internal detail/);
  });
});

describe("M144 checkout — asynchronous confirmation (M141 webhook)", () => {
  async function toAwaiting() {
    paymentAction.mockResolvedValue(payment());
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    fireEvent.submit(screen.getByRole("form", { name: "Payment details" }));
    await flush();
  }

  it("Stripe completing the payment does NOT reveal contact: the page waits for the authoritative CONFIRMED", async () => {
    statusAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    await toAwaiting();
    expect(stripe.confirmPayment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 2, name: "Confirming your payment" })).toBeInTheDocument();
    expect(contactAction).not.toHaveBeenCalled();
    expect(hasContact()).toBe(false);
    await flush(10_000);
    expect(contactAction).not.toHaveBeenCalled();
    expect(hasContact()).toBe(false);
  });

  it("uses redirect-if-required and a return URL that carries no state", async () => {
    statusAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    await toAwaiting();
    const args = stripe.confirmPayment.mock.calls[0]![0] as { redirect: string; confirmParams: { return_url: string } };
    expect(args.redirect).toBe("if_required");
    expect(args.confirmParams.return_url).toBe(`${window.location.origin}${window.location.pathname}`);
    expect(args.confirmParams.return_url).not.toMatch(/[?#]/);
  });

  it("requests the contact (M138) only after the server reports CONFIRMED, then shows exactly that DTO", async () => {
    statusAction.mockResolvedValueOnce({ success: true, purchase: purchase("PENDING_PAYMENT") }).mockResolvedValue({ success: true, purchase: purchase("CONFIRMED") });
    await toAwaiting();
    await flush(1500);
    expect(statusAction).toHaveBeenCalledTimes(1);
    expect(contactAction).not.toHaveBeenCalled();
    await flush(1500);
    expect(screen.getByRole("heading", { level: 2, name: "Lead purchased" })).toBeInTheDocument();
    expect(contactAction).toHaveBeenCalledTimes(1);
    expect(contactAction).toHaveBeenCalledWith(LEAD);
    expect(screen.getByText(M139_SECRET_EMAIL)).toBeInTheDocument();
    expect(screen.getByText("M139 Secret Customer Name")).toBeInTheDocument();
    expect(screen.getByText("+34600009999")).toBeInTheDocument();
    // polling stopped at the terminal state
    const calls = statusAction.mock.calls.length;
    await flush(60_000);
    expect(statusAction).toHaveBeenCalledTimes(calls);
  });

  it("polling is bounded, then offers a manual re-check; it never continues on its own", async () => {
    statusAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    await toAwaiting();
    await flush(LEAD_PURCHASE_POLL_INTERVALS_MS.reduce((a, b) => a + b, 0) + 100);
    expect(statusAction).toHaveBeenCalledTimes(LEAD_PURCHASE_POLL_INTERVALS_MS.length);
    expect(screen.getByRole("heading", { level: 2, name: "Still confirming your payment" })).toBeInTheDocument();
    await flush(10 * 60_000);
    expect(statusAction).toHaveBeenCalledTimes(LEAD_PURCHASE_POLL_INTERVALS_MS.length);
    expect(contactAction).not.toHaveBeenCalled();
    expect(hasContact()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await flush(LEAD_PURCHASE_POLL_INTERVALS_MS.reduce((a, b) => a + b, 0) + 100);
    expect(statusAction).toHaveBeenCalledTimes(LEAD_PURCHASE_POLL_INTERVALS_MS.length * 2);
  });

  it("tolerates transient read failures within the bound and still recovers", async () => {
    statusAction
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ success: false, error: "internal" })
      .mockResolvedValue({ success: true, purchase: purchase("CONFIRMED") });
    await toAwaiting();
    await flush(20_000);
    expect(screen.getByRole("heading", { level: 2, name: "Lead purchased" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/socket hang up|internal/);
  });

  it.each([
    ["FAILED", "Payment failed"],
    ["CANCELLED", "Purchase cancelled"],
    ["REFUNDED", "Lead unavailable"],
  ])("stops polling at the terminal %s state and never reveals contact", async (status, title) => {
    statusAction.mockResolvedValue({ success: true, purchase: purchase(status) });
    await toAwaiting();
    await flush(1500);
    expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    await flush(120_000);
    expect(statusAction).toHaveBeenCalledTimes(1);
    expect(contactAction).not.toHaveBeenCalled();
    expect(hasContact()).toBe(false);
  });

  it("cleans the polling timer up on unmount", async () => {
    statusAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    await toAwaiting();
    cleanup();
    await flush(120_000);
    expect(statusAction).not.toHaveBeenCalled();
  });

  it("ignores a late answer that arrives after unmount", async () => {
    let release: (v: unknown) => void = () => undefined;
    statusAction.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await toAwaiting();
    await flush(1500);
    cleanup();
    release({ success: true, purchase: purchase("CONFIRMED") });
    await flush(100);
    expect(contactAction).not.toHaveBeenCalled();
  });

  it("a Stripe error keeps the card form, shows a safe message and does not start waiting or polling", async () => {
    stripe.confirmPayment.mockResolvedValue({ error: { type: "card_error", message: "Your card was declined: raw stripe detail pm_123" } });
    paymentAction.mockResolvedValue(payment());
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    fireEvent.submit(screen.getByRole("form", { name: "Payment details" }));
    await flush(30_000);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't process this payment");
    expect(document.body.innerHTML).not.toMatch(/raw stripe detail|pm_123/);
    expect(screen.getByTestId("payment-element")).toBeInTheDocument();
    expect(statusAction).not.toHaveBeenCalled();
    expect(contactAction).not.toHaveBeenCalled();
  });

  it("protects against double submission of the card form", async () => {
    let release: (v: unknown) => void = () => undefined;
    stripe.confirmPayment.mockReturnValue(new Promise((resolve) => (release = resolve)));
    paymentAction.mockResolvedValue(payment());
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    const form = screen.getByRole("form", { name: "Payment details" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await flush();
    expect(stripe.confirmPayment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
    release({});
    await flush();
  });
});

describe("M144 checkout — recovery from the authoritative state", () => {
  it("an already CONFIRMED purchase never asks to pay again and loads the contact via M138", async () => {
    mount(purchase("CONFIRMED"));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Lead purchased" })).toBeInTheDocument();
    expect(paymentAction).not.toHaveBeenCalled();
    expect(startAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId("payment-element")).toBeNull();
    expect(contactAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText(M139_SECRET_EMAIL)).toBeInTheDocument();
  });

  it("shows a safe denial (no data) when M138 refuses the contact", async () => {
    contactAction.mockResolvedValue({ success: false, error: "internal detail" });
    mount(purchase("CONFIRMED"));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Contact details are not available for this purchase.");
    expect(hasContact()).toBe(false);
    expect(document.body.innerHTML).not.toMatch(/internal detail/);
  });

  it("offers a retry when loading the contact fails for a network reason", async () => {
    contactAction.mockRejectedValueOnce(new Error("ECONNRESET"));
    mount(purchase("CONFIRMED"));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load the contact details");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByText(M139_SECRET_EMAIL)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/ECONNRESET/);
  });

  it("FAILED shows a safe message and only an explicit, user-triggered new purchase", async () => {
    mount(purchase("FAILED"));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Payment failed" })).toBeInTheDocument();
    expect(startAction).not.toHaveBeenCalled();
    expect(paymentAction).not.toHaveBeenCalled();
    startAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT", { purchaseId: "66666666-6666-4666-8666-666666666666" }) });
    paymentAction.mockResolvedValue(payment());
    fireEvent.click(screen.getByRole("button", { name: "Start a new purchase" }));
    await flush();
    expect(startAction).toHaveBeenCalledTimes(1);
    expect(paymentAction).toHaveBeenCalledWith("66666666-6666-4666-8666-666666666666");
  });

  it("CANCELLED explains the purchase can't be reused and offers no way to resurrect it", async () => {
    mount(purchase("CANCELLED"));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Purchase cancelled" })).toBeInTheDocument();
    expect(screen.getByText(/can no longer be bought through it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /purchase|payment|pay/i })).toBeNull();
    expect(paymentAction).not.toHaveBeenCalled();
    expect(startAction).not.toHaveBeenCalled();
  });

  it.each(["REFUNDED", "REVOKED", "SOMETHING_NEW"])("an unexpected / non-purchasable status %s fails safe: no payment, no contact", async (status) => {
    mount(purchase(status));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Lead unavailable" })).toBeInTheDocument();
    expect(paymentAction).not.toHaveBeenCalled();
    expect(contactAction).not.toHaveBeenCalled();
    expect(hasContact()).toBe(false);
  });

  it("an unavailable lead without a purchase can't be bought", async () => {
    mount(null, { lead: null });
    expect(screen.getByRole("heading", { level: 2, name: "Lead unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  });

  it("a failed initial read shows a network error with a retry that re-reads the server", async () => {
    mount(undefined);
    expect(screen.getByRole("heading", { level: 2, name: "Connection problem" })).toBeInTheDocument();
    statusAction.mockResolvedValue({ success: true, purchase: purchase("CONFIRMED") });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Lead purchased" })).toBeInTheDocument();
  });

  it("always offers a way back to the marketplace", async () => {
    mount(purchase("CONFIRMED"));
    await flush();
    expect(screen.getByRole("link", { name: "Back to marketplace" })).toHaveAttribute("href", "/dashboard/professional/leads");
  });
});

describe("M144 checkout — safe errors", () => {
  it("a refused start shows a safe message and no raw backend text", async () => {
    startAction.mockResolvedValue({ success: false, error: "PrismaClientKnownRequestError P2002 stack trace" });
    mount(null);
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "We couldn't start this purchase" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/Prisma|P2002|stack trace/);
    expect(paymentAction).not.toHaveBeenCalled();
  });

  it("a thrown error (network) shows a safe message and allows retry", async () => {
    startAction.mockRejectedValueOnce(new Error("sk_live_SECRET fetch failed"));
    mount(null);
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Connection problem" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/sk_live_SECRET|fetch failed/);
    startAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    paymentAction.mockResolvedValue(payment());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(startAction).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("payment-element")).toBeInTheDocument();
  });

  it("a missing client secret from M140 is an error, not a form", async () => {
    paymentAction.mockResolvedValue(payment({ clientSecret: null }));
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    expect(screen.getByRole("heading", { level: 2, name: "Payment couldn't be started" })).toBeInTheDocument();
    expect(screen.queryByTestId("payment-element")).toBeNull();
  });
});

describe("M144 checkout — client DTO / rendered HTML leak checks", () => {
  it("never renders payment references, Stripe ids/secrets or internal fields, in any phase", async () => {
    startAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    paymentAction.mockResolvedValue(payment());
    statusAction.mockResolvedValue({ success: true, purchase: purchase("PENDING_PAYMENT") });
    mount(null);
    const forbidden = /paymentReference|clientSecret|pi_3SECRET|_secret_|sk_test|sk_live|whsec_|professionalProfileId|customerId|customerUserId/;
    const snapshots: string[] = [document.body.innerHTML];
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await flush();
    snapshots.push(document.body.innerHTML);
    fireEvent.submit(screen.getByRole("form", { name: "Payment details" }));
    await flush();
    snapshots.push(document.body.innerHTML);
    await flush(LEAD_PURCHASE_POLL_INTERVALS_MS.reduce((a, b) => a + b, 0));
    snapshots.push(document.body.innerHTML);
    for (const html of snapshots) {
      expect(html).not.toMatch(forbidden);
      for (const secret of M139_SENTINELS) expect(html).not.toContain(secret);
    }
  });

  it("the DOM exposes accessible status announcements and moves focus to the new status heading", async () => {
    paymentAction.mockResolvedValue(payment());
    mount(purchase("PENDING_PAYMENT"));
    await flush();
    const status = screen.getAllByRole("status")[0]!;
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("heading", { level: 2, name: "Pay securely" })).toHaveFocus();
  });
});
