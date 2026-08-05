import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResponsiveGrid } from "@/components/layout/responsive-grid";

describe("ResponsiveGrid", () => {
  it("renders children", () => {
    render(
      <ResponsiveGrid>
        <p>Item</p>
      </ResponsiveGrid>,
    );
    expect(screen.getByText("Item")).toBeTruthy();
  });

  it("renders as a <div> by default", () => {
    render(
      <ResponsiveGrid data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    expect(screen.getByTestId("grid").tagName).toBe("DIV");
  });

  it("renders as a <dl> when as is set", () => {
    render(
      <ResponsiveGrid as="dl" data-testid="grid">
        <div>Item</div>
      </ResponsiveGrid>,
    );
    expect(screen.getByTestId("grid").tagName).toBe("DL");
  });

  it("defaults to the 1-2 column layout with a md gap", () => {
    render(
      <ResponsiveGrid data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    const el = screen.getByTestId("grid").className;
    expect(el).toContain("grid-cols-1");
    expect(el).toContain("sm:grid-cols-2");
    expect(el).toContain("gap-4");
  });

  it("applies the static 2-column layout", () => {
    render(
      <ResponsiveGrid cols="2" data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    const el = screen.getByTestId("grid").className;
    expect(el).toContain("grid-cols-2");
    expect(el).not.toContain("sm:grid-cols-2");
  });

  it("applies the 1-2-lg column layout", () => {
    render(
      <ResponsiveGrid cols="1-2-lg" data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    const el = screen.getByTestId("grid").className;
    expect(el).toContain("grid-cols-1");
    expect(el).toContain("lg:grid-cols-2");
  });

  it("applies the 1-2-4 column layout", () => {
    render(
      <ResponsiveGrid cols="1-2-4" data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    const el = screen.getByTestId("grid").className;
    expect(el).toContain("grid-cols-1");
    expect(el).toContain("sm:grid-cols-2");
    expect(el).toContain("lg:grid-cols-4");
  });

  it("applies the sm and lg gap variants", () => {
    const { rerender } = render(
      <ResponsiveGrid gap="sm" data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    expect(screen.getByTestId("grid").className).toContain("gap-3");

    rerender(
      <ResponsiveGrid gap="lg" data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    expect(screen.getByTestId("grid").className).toContain("gap-6");
  });

  it("applies the bordered fact-grid styling", () => {
    render(
      <ResponsiveGrid bordered data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    const el = screen.getByTestId("grid").className;
    expect(el).toContain("rounded-md");
    expect(el).toContain("border-border");
    expect(el).toContain("text-sm");
  });

  it("omits the bordered styling by default", () => {
    render(
      <ResponsiveGrid data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    expect(screen.getByTestId("grid").className).not.toContain("border-border");
  });

  it("merges a custom className", () => {
    render(
      <ResponsiveGrid className="custom-class" data-testid="grid">
        <p>Item</p>
      </ResponsiveGrid>,
    );
    expect(screen.getByTestId("grid").className).toContain("custom-class");
  });

  it("forwards a ref to the underlying element", () => {
    let ref: HTMLDivElement | null = null;
    render(
      <ResponsiveGrid
        ref={(node) => {
          ref = node;
        }}
      >
        <p>Item</p>
      </ResponsiveGrid>,
    );
    expect(ref).not.toBeNull();
  });
});
