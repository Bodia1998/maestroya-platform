import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/components/dashboard/page-header";

describe("PageHeader", () => {
  it("renders the title as a heading", () => {
    render(<PageHeader title="Service requests" />);
    expect(screen.getByRole("heading", { name: "Service requests" })).toBeTruthy();
  });

  it("renders an optional subtitle", () => {
    render(<PageHeader title="Service requests" subtitle="Manage your open requests" />);
    expect(screen.getByText("Manage your open requests")).toBeTruthy();
  });

  it("omits the subtitle when not provided", () => {
    render(<PageHeader title="Service requests" />);
    expect(screen.queryByText("Manage your open requests")).toBeNull();
  });

  it("renders action content", () => {
    render(<PageHeader title="Service requests" actions={<button type="button">New request</button>} />);
    expect(screen.getByRole("button", { name: "New request" })).toBeTruthy();
  });

  it("renders a breadcrumb trail when provided, with the last item marked current", () => {
    render(
      <PageHeader
        title="Detail"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Detail" }]}
      />,
    );

    // "Detail" appears twice — once as the page title, once as the last
    // breadcrumb item — so a plain `getByText` is ambiguous. Scope each
    // assertion to its semantic landmark instead.
    expect(screen.getByRole("heading", { name: "Detail" })).toBeTruthy();

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const lastCrumb = within(nav).getByText("Detail");
    expect(lastCrumb.getAttribute("aria-current")).toBe("page");
  });

  it("omits the breadcrumb nav when the list is empty", () => {
    render(<PageHeader title="Detail" breadcrumbs={[]} />);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("does not throw with the full combination of optional props", () => {
    expect(() =>
      render(
        <PageHeader
          title="Detail"
          subtitle="Subtitle"
          breadcrumbs={[{ label: "Home", href: "/" }, { label: "Detail" }]}
          actions={<button type="button">Action</button>}
          className="custom-class"
        />,
      ),
    ).not.toThrow();
  });
});
