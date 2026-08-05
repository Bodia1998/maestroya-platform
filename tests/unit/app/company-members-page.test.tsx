import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
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
// RemoveMemberButton and TransferOwnershipDialog (Module 30.6) call
// useRouter().refresh() after a successful action. Without a mock, Next's
// App Router context isn't mounted under `render()` and useRouter() throws
// "invariant expected app router to be mounted". Same inline-mock pattern
// already used by e.g. tests/unit/app/quote-form.test.tsx.
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockBack = vi.fn();
const mockForward = vi.fn();
const mockPrefetch = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
    back: mockBack,
    forward: mockForward,
    prefetch: mockPrefetch,
  }),
}));

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
  mockPush.mockReset();
  mockReplace.mockReset();
  mockRefresh.mockReset();
  mockBack.mockReset();
  mockForward.mockReset();
  mockPrefetch.mockReset();
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

  it("renders the transfer-ownership section with a confirm dialog exposing associated, labeled fields", async () => {
    const element = await CompanyMembersPage({ params: Promise.resolve({ companyId: "company-1" }) });
    render(element);

    expect(screen.getByRole("heading", { name: "Transfer ownership" })).toBeTruthy();

    // The new-owner select and confirmation input live inside a ConfirmDialog
    // (Module 30.6) that isn't mounted until its trigger is clicked.
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(screen.getByLabelText("New owner")).toBeTruthy();
    expect(screen.getByLabelText("Type TRANSFER to confirm")).toBeTruthy();
  });

  it("only lists non-owner active members as transfer-ownership candidates", async () => {
    const element = await CompanyMembersPage({ params: Promise.resolve({ companyId: "company-1" }) });
    render(element);

    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    const select = screen.getByLabelText("New owner") as HTMLSelectElement;
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
