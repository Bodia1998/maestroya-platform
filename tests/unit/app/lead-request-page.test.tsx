import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/domain/errors/domain-error";

/** Module 142 — the page lists exactly what the backend use case returns (localized for display). */
const mockRequireAuth = vi.fn();
const listExecute = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/requests/new/lead" }));
vi.mock("@/infrastructure/auth/rbac", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/application/use-cases/lead-request/compose", () => ({
  makeListLeadRequestCategoriesUseCase: () => ({ execute: listExecute }),
}));
vi.mock("@/app/(dashboard)/requests/new/lead/actions", () => ({ submitLeadRequestAction: vi.fn() }));

const { default: NewLeadRequestPage } = await import("../../../src/app/(dashboard)/requests/new/lead/page");

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ id: "u1", roles: ["CUSTOMER"] });
});

describe("NewLeadRequestPage", () => {
  it("renders the form with the supported categories only, localized from the catalog", async () => {
    listExecute.mockResolvedValue([
      { id: "123e4567-e89b-42d3-a456-426614174001", slug: "fontaneria", name: "Fontanería" },
      { id: "123e4567-e89b-42d3-a456-426614174002", slug: "pintura", name: "Pintura" },
    ]);
    render(await NewLeadRequestPage());
    expect(screen.getByRole("heading", { name: "Request a service" })).toBeTruthy();
    const options = Array.from(screen.getByLabelText(/Service category/).querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toHaveLength(3);
    expect(options.join("|")).not.toMatch(/Reformas|Renovation/i);
  });

  it("shows the unavailable state when the backend offers no category", async () => {
    listExecute.mockResolvedValue([]);
    render(await NewLeadRequestPage());
    expect(screen.getByText("Requests are temporarily unavailable")).toBeTruthy();
  });

  it("requires authentication before reading anything", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    await expect(NewLeadRequestPage()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(listExecute).not.toHaveBeenCalled();
  });
});
