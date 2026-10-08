import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadFeedItemDTO } from "@/application/dto/lead-feed.dto";

import { M139_SENTINELS, assertNoContactLeak } from "../../test-utils/contact-leak-sentinels";

/** Module 143 — the marketplace component renders exactly what the (mocked) M134 action returns and never pays. */
const feedAction = vi.fn();
const paymentAction = vi.fn();

vi.mock("@/app/(dashboard)/dashboard/professional/leads/actions", () => ({ getLeadFeedAction: (...args: unknown[]) => feedAction(...args) }));
vi.mock("@/app/(dashboard)/dashboard/professional/leads/payment-actions", () => ({ initiateLeadFeePaymentAction: (...args: unknown[]) => paymentAction(...args) }));

const { LeadMarketplace } = await import("../../../src/app/(dashboard)/dashboard/professional/leads/lead-marketplace");

const CAT = "33333333-3333-4333-8333-333333333333";
const item = (n: number, patch: Partial<LeadFeedItemDTO> = {}): LeadFeedItemDTO => ({
  leadId: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Leaking tap ${n}`,
  description: `Description ${n}`,
  categoryId: CAT,
  categoryName: "Fontanería",
  urgency: "HIGH",
  city: "Madrid",
  province: "Madrid",
  distanceKm: 3.2,
  price: "12.50",
  currency: "EUR",
  buyerPolicy: { maxBuyers: 3 },
  publishedAt: new Date("2026-10-06T10:00:00Z"),
  ...patch,
});

const renderMarketplace = (props: Partial<React.ComponentProps<typeof LeadMarketplace>> = {}) =>
  render(<LeadMarketplace initialItems={[]} initialNextCursor={null} initialFailed={false} categoryNames={{ [CAT]: "Plumbing" }} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LeadMarketplace — rendering", () => {
  it("renders one accessible card per lead with only the safe feed fields", () => {
    renderMarketplace({ initialItems: [item(1), item(2)] });
    expect(screen.getByRole("region", { name: "Available leads" })).toBeInTheDocument();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    const first = within(cards[0]!);
    expect(first.getByRole("heading", { level: 2, name: "Leaking tap 1" })).toBeInTheDocument();
    expect(first.getByText("Plumbing")).toBeInTheDocument();
    expect(first.getByText("Description 1")).toBeInTheDocument();
    expect(first.getByText(/Madrid, Madrid/)).toBeInTheDocument();
    expect(first.getByText(/€12\.50|12\.50/)).toBeInTheDocument();
    expect(first.getByText("Maximum buyers: 3")).toBeInTheDocument();
    expect(first.getByText(/Contact details stay hidden/)).toBeInTheDocument();
  });

  it("falls back to the feed's own category name when no localization is known", () => {
    renderMarketplace({ initialItems: [item(1)], categoryNames: {} });
    expect(screen.getByText("Fontanería")).toBeInTheDocument();
  });

  it("shows the empty state without internal reasons", () => {
    renderMarketplace();
    expect(screen.getByText("No leads available right now")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("shows a safe error state when the first page failed", () => {
    renderMarketplace({ initialFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load the leads");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("LeadMarketplace — retry and loading", () => {
  it("shows a busy loading state while retrying, then the leads", async () => {
    let resolve!: (v: unknown) => void;
    feedAction.mockReturnValue(new Promise((r) => (resolve = r)));
    renderMarketplace({ initialFailed: true });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading available leads…");
    await act(async () => resolve({ success: true, items: [item(1)], nextCursor: null }));
    expect(await screen.findByRole("heading", { name: "Leaking tap 1" })).toBeInTheDocument();
    expect(feedAction).toHaveBeenCalledTimes(1);
    expect(feedAction).toHaveBeenCalledWith(undefined);
  });

  it("returns to the error state (no raw message) when the retry fails or throws", async () => {
    feedAction.mockResolvedValueOnce({ success: false, error: "PrismaClientKnownRequestError: P2002 pi_secret" });
    renderMarketplace({ initialFailed: true });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the leads");
    expect(document.body.innerHTML).not.toMatch(/Prisma|P2002|pi_secret/);

    feedAction.mockRejectedValueOnce(new Error("boom stack trace"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(feedAction).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/boom|stack trace/);
  });
});

describe("LeadMarketplace — keyset pagination", () => {
  it("hides 'Load more' at the end of the feed", () => {
    renderMarketplace({ initialItems: [item(1)], initialNextCursor: null });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("sends back the opaque cursor unchanged, appends the page and drops duplicates", async () => {
    feedAction.mockResolvedValue({ success: true, items: [item(1), item(2)], nextCursor: "cursor-2" });
    renderMarketplace({ initialItems: [item(1)], initialNextCursor: "cursor-1" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(feedAction).toHaveBeenCalledWith({ cursor: "cursor-1" });
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();

    feedAction.mockResolvedValue({ success: true, items: [], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
    expect(feedAction).toHaveBeenLastCalledWith({ cursor: "cursor-2" });
  });

  it("does not fire duplicate requests on repeated clicks", async () => {
    let resolve!: (v: unknown) => void;
    feedAction.mockReturnValue(new Promise((r) => (resolve = r)));
    renderMarketplace({ initialItems: [item(1)], initialNextCursor: "cursor-1" });
    const button = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(feedAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Loading…" })).toBeDisabled();
    await act(async () => resolve({ success: true, items: [item(2)], nextCursor: null }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("keeps the loaded leads and offers a retry when loading more fails", async () => {
    feedAction.mockRejectedValueOnce(new Error("network"));
    renderMarketplace({ initialItems: [item(1)], initialNextCursor: "cursor-1" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("We couldn't load more leads. Please try again.")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);

    feedAction.mockResolvedValueOnce({ success: true, items: [item(2)], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(feedAction).toHaveBeenLastCalledWith({ cursor: "cursor-1" });
  });
});

describe("LeadMarketplace — purchase CTA boundary (M144 not implemented)", () => {
  it("renders a disabled CTA that performs no payment, navigation or action call", () => {
    renderMarketplace({ initialItems: [item(1)] });
    const cta = screen.getByRole("button", { name: "Purchase coming soon" });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(paymentAction).not.toHaveBeenCalled();
    expect(feedAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).not.toMatch(/(has been|was) purchased|purchase (complete|successful|confirmed)|unlocked|payment (confirmed|successful)/i);
  });
});

describe("LeadMarketplace — security: nothing outside the M134 whitelist reaches the DOM", () => {
  it("never renders contact, payment or purchase data even if an over-fetched object slips through", () => {
    const leaky = {
      ...item(1),
      email: M139_SENTINELS[0],
      phone: M139_SENTINELS[1],
      line1: M139_SENTINELS[2],
      postalCode: M139_SENTINELS[3],
      customerName: M139_SENTINELS[4],
      customerId: "internal-customer-id",
      customerUserId: "internal-user-id",
      paymentReference: "pi_3SecretPaymentIntent",
      stripeCustomerId: "cus_SecretStripe",
      clientSecret: "pi_3Secret_secret_abc",
      purchaseId: "purchase-internal-id",
      taxAmount: "2.63",
      professionalProfileId: "pro-internal-id",
    } as unknown as LeadFeedItemDTO;
    const { container } = renderMarketplace({ initialItems: [leaky] });
    const html = container.innerHTML;
    expect(() =>
      assertNoContactLeak(html, ["internal-customer-id", "internal-user-id", "pi_3", "cus_", "purchase-internal-id", "pro-internal-id", "2.63", "paymentReference"]),
    ).not.toThrow();
    expect(html).not.toMatch(/mailto:|tel:/);
  });
});
