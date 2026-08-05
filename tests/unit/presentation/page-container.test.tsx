import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageContainer } from "@/components/layout/page-container";

describe("PageContainer", () => {
  it("renders children", () => {
    render(
      <PageContainer>
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("defaults to the 2xl max-width and md gap", () => {
    render(
      <PageContainer data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    const container = screen.getByTestId("container");
    expect(container.className).toContain("max-w-2xl");
    expect(container.className).toContain("gap-8");
  });

  it("applies the 3xl max-width variant", () => {
    render(
      <PageContainer maxWidth="3xl" data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByTestId("container").className).toContain("max-w-3xl");
  });

  it("applies the 6xl max-width variant", () => {
    render(
      <PageContainer maxWidth="6xl" data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByTestId("container").className).toContain("max-w-6xl");
  });

  it("applies the sm and lg gap variants", () => {
    const { rerender } = render(
      <PageContainer gap="sm" data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByTestId("container").className).toContain("gap-6");

    rerender(
      <PageContainer gap="lg" data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByTestId("container").className).toContain("gap-10");
  });

  it("omits padding by default", () => {
    render(
      <PageContainer data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByTestId("container").className).not.toContain("px-4");
  });

  it("applies padding when padded is set", () => {
    render(
      <PageContainer padded data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByTestId("container").className).toContain("px-4");
    expect(screen.getByTestId("container").className).toContain("py-10");
  });

  it("merges a custom className", () => {
    render(
      <PageContainer className="custom-class" data-testid="container">
        <p>Content</p>
      </PageContainer>,
    );
    expect(screen.getByTestId("container").className).toContain("custom-class");
  });

  it("forwards a ref to the underlying element", () => {
    const refHolder: { current: HTMLDivElement | null } = { current: null };
    render(
      <PageContainer
        ref={(node) => {
          refHolder.current = node;
        }}
      >
        <p>Content</p>
      </PageContainer>,
    );
    expect(refHolder.current).not.toBeNull();
    expect(refHolder.current?.tagName).toBe("DIV");
  });
});
