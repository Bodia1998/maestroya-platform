import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormSection } from "@/components/forms/form-section";

describe("FormSection", () => {
  it("renders the title as a heading", () => {
    render(
      <FormSection title="Contact">
        <p>Field content</p>
      </FormSection>,
    );
    expect(screen.getByRole("heading", { name: "Contact" })).toBeTruthy();
  });

  it("renders the heading as an h2 element", () => {
    render(
      <FormSection title="Contact">
        <p>Field content</p>
      </FormSection>,
    );
    const heading = screen.getByRole("heading", { name: "Contact" });
    expect(heading.tagName).toBe("H2");
  });

  it("renders an optional description", () => {
    render(
      <FormSection title="Contact" description="How we reach you.">
        <p>Field content</p>
      </FormSection>,
    );
    expect(screen.getByText("How we reach you.")).toBeTruthy();
  });

  it("omits the description when not provided", () => {
    render(
      <FormSection title="Contact">
        <p>Field content</p>
      </FormSection>,
    );
    expect(screen.queryByText("How we reach you.")).toBeNull();
  });

  it("renders children", () => {
    render(
      <FormSection title="Contact">
        <button type="button">A field</button>
      </FormSection>,
    );
    expect(screen.getByRole("button", { name: "A field" })).toBeTruthy();
  });

  it("renders titleAside content next to the title", () => {
    render(
      <FormSection title="Contact" titleAside={<span data-testid="aside">Required</span>}>
        <p>Field content</p>
      </FormSection>,
    );
    expect(screen.getByTestId("aside")).toBeTruthy();
  });
});
