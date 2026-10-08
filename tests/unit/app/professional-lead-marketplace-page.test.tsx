import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/domain/errors/domain-error";

/** Module 143 — the page takes identity from the session only and reads the feed through the M134 Server Action. */
const mockRequireAuth = vi.fn();
const feedAction = vi.fn();
const listCategories = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard/professional/leads" }));
vi.mock("@/infrastructure/auth/rbac", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/application/use-cases/lead-request/compose", () => ({ makeListLeadRequestCategoriesUseCase: () => ({ execute: listCategories }) }));
vi.mock("@/app/(dashboard)/dashboard/professional/leads/actions", () => ({ getLeadFeedAction: (...args: unknown[]) => feedAction(...args) }));

const { default: Page } = await import("../../../src/app/(dashboard)/dashboard/professional/leads/page");

const lead = {
  leadId: "00000000-0000-4000-8000-000000000001",
  title: "Leaking tap",
  description: "Dripping for two days",
  categoryId: "cat-1",
  categoryName: "Fontanería",
  urgency: "MEDIUM",
  city: "Madrid",
  province: null,
  distanceKm: 1.5,
  price: "10.00",
  currency: "EUR",
  buyerPolicy: { maxBuyers: 2 },
  publishedAt: new Date("2026-10-06T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ id: "pro-user", roles: ["CUSTOMER", "PROVIDER"] });
  listCategories.mockResolvedValue([{ id: "cat-1", slug: "fontaneria", name: "Fontanería" }]);
});

describe("ProfessionalLeadMarketplacePage", () => {
  it("renders the title, explanation and the feed's leads with localized category names", async () => {
    feedAction.mockResolvedValue({ success: true, items: [lead], nextCursor: "next" });
    render(await Page());
    expect(screen.getByRole("heading", { level: 1, name: "Lead marketplace" })).toBeInTheDocument();
    expect(screen.getByText(/shared only after you purchase a lead/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Leaking tap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("calls the feed action with no client-controlled identity or filter", async () => {
    feedAction.mockResolvedValue({ success: true, items: [], nextCursor: null });
    render(await Page());
    expect(feedAction).toHaveBeenCalledTimes(1);
    expect(feedAction.mock.calls[0]).toEqual([]);
  });

  it("requires a session before reading anything", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    await expect(Page()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(feedAction).not.toHaveBeenCalled();
  });

  it("shows the empty state for a non-professional / ineligible caller (M134 returns an empty page)", async () => {
    feedAction.mockResolvedValue({ success: true, items: [], nextCursor: null });
    render(await Page());
    expect(screen.getByText("No leads available right now")).toBeInTheDocument();
  });

  it.each([
    ["a failure result", () => feedAction.mockResolvedValue({ success: false, error: "internal detail" })],
    ["a thrown error", () => feedAction.mockRejectedValue(new Error("db down"))],
  ])("shows a safe, retryable error state on %s", async (_label, arrange) => {
    arrange();
    render(await Page());
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load the leads");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/internal detail|db down/);
  });

  it("still renders the leads when the (display-only) category list is unavailable", async () => {
    feedAction.mockResolvedValue({ success: true, items: [lead], nextCursor: null });
    listCategories.mockRejectedValue(new Error("down"));
    render(await Page());
    expect(screen.getByText("Fontanería")).toBeInTheDocument();
  });
});
