import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminNav } from "../../../src/app/(dashboard)/admin/admin-nav";

const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

const ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/disputes", label: "Disputes" },
];

beforeEach(() => {
  mockUsePathname.mockReset();
});

describe("AdminNav", () => {
  it("renders every provided item as a link, grouped under the Admin nav landmark", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<AdminNav items={ITEMS} />);

    const nav = screen.getByRole("navigation", { name: "Admin navigation" });
    expect(nav).toBeTruthy();
    for (const item of ITEMS) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
    }
  });

  it("marks only the item matching the exact /admin pathname as current", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<AdminNav items={ITEMS} />);

    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks a nested route as active for its parent item, but not /admin itself", () => {
    mockUsePathname.mockReturnValue("/admin/users/123");
    render(<AdminNav items={ITEMS} />);

    expect(screen.getByRole("link", { name: "Users" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  it("reflects the active item across route changes", () => {
    mockUsePathname.mockReturnValue("/admin");
    const { rerender } = render(<AdminNav items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");

    mockUsePathname.mockReturnValue("/admin/disputes");
    rerender(<AdminNav items={ITEMS} />);

    expect(screen.getByRole("link", { name: "Disputes" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  it("does not throw on Tab/Enter keyboard interaction with a link", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<AdminNav items={ITEMS} />);
    const link = screen.getByRole("link", { name: "Users" });

    link.focus();
    expect(() => fireEvent.keyDown(link, { key: "Enter" })).not.toThrow();
    expect(document.activeElement).toBe(link);
  });

  it("renders no items when given an empty list", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<AdminNav items={[]} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
