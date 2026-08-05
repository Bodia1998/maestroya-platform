import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the restyled company Members page (module
 * 30.4) — the one form in this sample built on native Server Action
 * `<form action>` bindings rather than react-hook-form. `CompanyMembersPage`
 * is an async Server Component; it's called directly and its resolved
 * JSX is handed to `render()`, the same pattern this repo already has no
 * precedent for but which works because a Server Component is just an
 * async function returning JSX.
 */
const mockRequireAuth = vi.fn();
vi.mock("@/infrastructure/auth/rbac", () => ({
  requireAuth: () => mockRequireAuth(),
}));

const mockGetCompanyForMember = vi.fn();
vi.mock("@/application/use-cases/company/compose", () => ({
  makeGetCompanyForMemberUseCase: () => ({ execute: mockGetCompanyForMember }),
}));

const mockListCompanyMembers = vi.fn();
vi.mock("@/application/use-cases/company-membership/compose", () => ({
  makeListCompanyMembersUseCase: () => ({ execute: mockListCompanyMembers }),
  makeChangeCompanyMemberRoleUseCase: () => ({ execute: vi.fn() }),
  makeRemoveCompanyMemberUseCase: () => ({ execute: vi.fn() }),
  makeTransferCompanyOwnershipUseCase: () => ({ execute: vi.fn() }),
}));

const { default: CompanyMembersPage } = await import(
  "../../../src/app/(dashboard)/dashboard/company/[companyId]/members/page"
);

const company = { id: "company-1", legalName: "Acme SL", tradeName: "Acme" };

const members = [
  {
    id: "member-1",
    userId: "user-1",
    userName: "Alice Owner",
    userEmail: "alice@example.com",
    role: "OWNER",
    joinedAt: new Date("2024-01-01"),
    removedAt: null,
  },
  {
    id: "member-2",
    userId: "user-2",
    userName: "Bob Manager",
    userEmail: "bob@example.com",
    role: "MANAGER",
    joinedAt: new Date("2024-02-01"),
    removedAt: null,
  },
];

beforeEach(() => {
  mockRequireAuth.mockReset().mockResolvedValue({ id: "user-1", email: "alice@example.com", roles: [] });
  mockGetCompanyForMember.mockReset().mockResolvedValue(company);
  mockListCompanyMembers.mockReset().mockResolvedValue(members);
});

describe("CompanyMembersPage", () => {
  it("renders a per-row role select associated with its (visually hidden) label", async () => {
    const element = await CompanyMembersPage({ params: Promise.resolve({ companyId: "company-1" }) });
    render(element);

    // Bob is a non-owner active member, so gets a role-change form; Alice
    // (OWNER) does not.
    expect(screen.getByLabelText("Role for Bob Manager")).toBeTruthy();
    expect(screen.queryByLabelText("Role for Alice Owner")).toBeNull();
  });

  it("renders the transfer-ownership section as a FormSection with associated, labeled fields", async () => {
    const element = await CompanyMembersPage({ params: Promise.resolve({ companyId: "company-1" }) });
    render(element);

    expect(screen.getByRole("heading", { name: "Transfer ownership" })).toBeTruthy();
    expect(screen.getByLabelText("New owner (member ID)")).toBeTruthy();
    expect(screen.getByLabelText("Type TRANSFER to confirm")).toBeTruthy();
  });

  it("only lists non-owner active members as transfer-ownership candidates", async () => {
    const element = await CompanyMembersPage({ params: Promise.resolve({ companyId: "company-1" }) });
    render(element);

    const select = screen.getByLabelText("New owner (member ID)") as HTMLSelectElement;
    const optionLabels = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionLabels).toEqual(["Bob Manager"]);
  });

  it("lists both members in the table", async () => {
    const element = await CompanyMembersPage({ params: Promise.resolve({ companyId: "company-1" }) });
    render(element);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Alice Owner")).toBeTruthy();
    expect(within(table).getByText("Bob Manager")).toBeTruthy();
  });
});
