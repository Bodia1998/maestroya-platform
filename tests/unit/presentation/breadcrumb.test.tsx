import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Breadcrumb } from "@/components/ui/breadcrumb";

describe("Breadcrumb", () => {
  it("renders every item's label", () => {
    render(
      <Breadcrumb
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Requests", href: "/requests" }, { label: "Detail" }]}
      />,
    );

    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Requests")).toBeTruthy();
    expect(screen.getByText("Detail")).toBeTruthy();
  });

  it("marks the last item as the current page and does not link it", () => {
    render(
      <Breadcrumb
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Detail", href: "/detail" }]}
      />,
    );

    const current = screen.getByText("Detail");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.closest("a")).toBeNull();
  });

  it("links every non-last item that has an href", () => {
    render(
      <Breadcrumb
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Detail" }]}
      />,
    );

    const link = screen.getByText("Dashboard").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveProperty("href", expect.stringContaining("/dashboard"));
  });

  it("exposes the trail via an accessible nav landmark", () => {
    render(<Breadcrumb items={[{ label: "Only item" }]} />);

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  });
});
