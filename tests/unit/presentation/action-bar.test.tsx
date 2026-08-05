import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionBar } from "@/components/layout/action-bar";

describe("ActionBar", () => {
  it("renders children", () => {
    render(
      <ActionBar>
        <button type="button">Edit</button>
      </ActionBar>,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("renders as a <section> element", () => {
    render(
      <ActionBar data-testid="bar">
        <button type="button">Edit</button>
      </ActionBar>,
    );
    expect(screen.getByTestId("bar").tagName).toBe("SECTION");
  });

  it("applies the divider and wrap styling by default", () => {
    render(
      <ActionBar data-testid="bar">
        <button type="button">Edit</button>
      </ActionBar>,
    );
    const el = screen.getByTestId("bar").className;
    expect(el).toContain("border-t");
    expect(el).toContain("pt-6");
    expect(el).toContain("flex-wrap");
  });

  it("omits items-center by default", () => {
    render(
      <ActionBar data-testid="bar">
        <button type="button">Edit</button>
      </ActionBar>,
    );
    expect(screen.getByTestId("bar").className).not.toContain("items-center");
  });

  it("applies items-center when itemsCenter is set", () => {
    render(
      <ActionBar itemsCenter data-testid="bar">
        <button type="button">Edit</button>
      </ActionBar>,
    );
    expect(screen.getByTestId("bar").className).toContain("items-center");
  });

  it("renders multiple action children", () => {
    render(
      <ActionBar>
        <button type="button">Edit</button>
        <button type="button">Cancel</button>
      </ActionBar>,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("merges a custom className", () => {
    render(
      <ActionBar className="custom-class" data-testid="bar">
        <button type="button">Edit</button>
      </ActionBar>,
    );
    expect(screen.getByTestId("bar").className).toContain("custom-class");
  });

  it("forwards a ref to the underlying element", () => {
    let ref: HTMLDivElement | null = null;
    render(
      <ActionBar
        ref={(node) => {
          ref = node;
        }}
      >
        <button type="button">Edit</button>
      </ActionBar>,
    );
    expect(ref).not.toBeNull();
  });
});
