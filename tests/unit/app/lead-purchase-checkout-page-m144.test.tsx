import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/domain/errors/domain-error";

import { M139_SENTINELS } from "../../test-utils/contact-leak-sentinels";

/** Module 144 — the checkout page: session first, lookup id only, authoritative state, no secrets/contact in the HTML. */
const mockRequireAuth = vi.fn();
const statusAction = vi.fn();
const previewAction = vi.fn();
const listCategories = vi.fn();
const contactAction = vi.fn();
const paymentAction = vi.fn();
const startAction = vi.fn();

vi.mock("@/infrastructure/auth/rbac", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/application/use-cases/lead-request/compose", () => ({ makeListLeadRequestCategoriesUseCase: () => ({ execute: listCategories }) }));
vi.mock("@/app/(dashboard)/dashboard/professional/leads/actions", () => ({
  getLeadPreviewAction: (...a: unknown[]) => previewAction(...a),
  getLeadContactAction: (...a: unknown[]) => contactAction(...a),
}));
vi.mock("@/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase/actions", () => ({
  getLeadPurchaseCheckoutAction: (...a: unknown[]) => statusAction(...a),
  startLeadPurchaseAction: (...a: unknown[]) => startAction(...a),
}));
vi.mock("@/app/(dashboard)/dashboard/professional/leads/payment-actions", () => ({ initiateLeadFeePaymentAction: (...a: unknown[]) => paymentAction(...a) }));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({})) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({}),
}));

const { default: Page } = await import("../../../src/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase/page");

const LEAD = "11111111-1111-4111-8111-111111111111";
const preview = {
  success: true,
  lead: { leadId: LEAD, title: "Leaking tap", description: "Dripping for two days", categoryId: "cat-1", categoryName: "Fontanería", urgency: "MEDIUM", city: "Madrid", province: null, distanceKm: 2, createdAt: new Date() },
};
const params = (leadId: string) => ({ params: Promise.resolve({ leadId }) });
const purchase = (status: string) => ({ purchaseId: "55555555-5555-4555-8555-555555555555", leadId: LEAD, status, feeAmount: "100.00", taxAmount: "21.00", totalAmount: "121.00", currency: "EUR" });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ id: "pro-user", roles: ["CUSTOMER", "PROVIDER"] });
  listCategories.mockResolvedValue([{ id: "cat-1", slug: "fontaneria", name: "Fontanería" }]);
  previewAction.mockResolvedValue(preview);
  statusAction.mockResolvedValue({ success: true, purchase: null });
  contactAction.mockResolvedValue({ success: false, error: "denied" });
});
afterEach(cleanup);

describe("ProfessionalLeadPurchasePage", () => {
  it("requires a session before reading anything (unauthenticated access rejected)", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    await expect(Page(params(LEAD))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(statusAction).not.toHaveBeenCalled();
    expect(previewAction).not.toHaveBeenCalled();
  });

  it("renders the title, the lead summary and the review step for an authenticated professional", async () => {
    render(await Page(params(LEAD)));
    expect(screen.getByRole("heading", { level: 1, name: "Buy this lead" })).toBeInTheDocument();
    expect(screen.getByText("Leaking tap")).toBeInTheDocument();
    expect(screen.getByText("Dripping for two days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeInTheDocument();
    expect(statusAction).toHaveBeenCalledWith(LEAD);
    expect(previewAction).toHaveBeenCalledWith(LEAD);
  });

  it("treats the URL id only as a lookup key: both server reads get it, nothing else is derived from it", async () => {
    await Page(params("someone-elses-purchase-123"));
    expect(statusAction).toHaveBeenCalledWith("someone-elses-purchase-123");
    expect(statusAction.mock.calls[0]).toHaveLength(1);
  });

  it("handles an invalid / unavailable lead safely (no purchase, no preview)", async () => {
    previewAction.mockResolvedValue({ success: false, error: "internal detail" });
    render(await Page(params("not-a-uuid")));
    expect(screen.getByRole("heading", { level: 2, name: "Lead unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/internal detail/);
  });

  it("survives a failing server read with a retryable error (no raw message)", async () => {
    statusAction.mockRejectedValue(new Error("db down"));
    previewAction.mockRejectedValue(new Error("db down"));
    render(await Page(params(LEAD)));
    expect(screen.getByRole("heading", { level: 2, name: "Connection problem" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/db down/);
  });

  it("renders the authoritative financial values for an existing purchase", async () => {
    statusAction.mockResolvedValue({ success: true, purchase: purchase("FAILED") });
    render(await Page(params(LEAD)));
    const summary = screen.getByRole("region", { name: "Order summary" });
    expect(summary).toHaveTextContent("€100.00");
    expect(summary).toHaveTextContent("€21.00");
    expect(summary).toHaveTextContent("€121.00");
  });

  it("server-renders no contact data and no secrets, even for a CONFIRMED purchase (contact is fetched client-side from M138)", async () => {
    statusAction.mockResolvedValue({ success: true, purchase: purchase("CONFIRMED") });
    const { container } = render(await Page(params(LEAD)));
    const html = container.innerHTML; // server-rendered markup, before any client effect runs
    await act(async () => {
      await Promise.resolve();
    });
    for (const secret of M139_SENTINELS) expect(html).not.toContain(secret);
    expect(html).not.toMatch(/sk_test_placeholder|whsec_|paymentReference|clientSecret|customerUserId/);
  });

  it("never calls the payment or purchase-creation actions while rendering (no side effect on GET)", async () => {
    render(await Page(params(LEAD)));
    expect(paymentAction).not.toHaveBeenCalled();
    expect(startAction).not.toHaveBeenCalled();
  });
});
