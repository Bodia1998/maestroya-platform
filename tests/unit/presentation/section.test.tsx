import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Section } from "@/components/layout/section";

describe("Section", () => {
  it("renders children", () => {
    render(
      <Section>
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByText("Body content")).toBeTruthy();
  });

  it("renders as a <section> element", () => {
    render(
      <Section data-testid="section">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByTestId("section").tagName).toBe("SECTION");
  });

  it("omits the title heading when not provided", () => {
    render(
      <Section>
        <p>Body content</p>
      </Section>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the title as an h2 heading", () => {
    render(
      <Section title="Documents">
        <p>Body content</p>
      </Section>,
    );
    const heading = screen.getByRole("heading", { name: "Documents" });
    expect(heading.tagName).toBe("H2");
  });

  it("applies danger styling to the title when titleTone is danger", () => {
    render(
      <Section title="Danger zone" titleTone="danger">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { name: "Danger zone" }).className).toContain("text-danger");
  });

  it("does not apply danger styling by default", () => {
    render(
      <Section title="Documents">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { name: "Documents" }).className).not.toContain("text-danger");
  });

  it("applies the bordered card styling", () => {
    render(
      <Section bordered data-testid="section">
        <p>Body content</p>
      </Section>,
    );
    const el = screen.getByTestId("section").className;
    expect(el).toContain("rounded-md");
    expect(el).toContain("border");
    expect(el).toContain("p-4");
  });

  it("omits the bordered styling by default", () => {
    render(
      <Section data-testid="section">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByTestId("section").className).not.toContain("border-border");
  });

  it("applies the divider styling", () => {
    render(
      <Section divider data-testid="section">
        <p>Body content</p>
      </Section>,
    );
    const el = screen.getByTestId("section").className;
    expect(el).toContain("border-t");
    expect(el).toContain("pt-6");
  });

  it("applies the requested gap size", () => {
    const { rerender } = render(
      <Section gap="sm" data-testid="section">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByTestId("section").className).toContain("gap-2");

    rerender(
      <Section gap="lg" data-testid="section">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByTestId("section").className).toContain("gap-4");
  });

  it("applies a custom titleClassName", () => {
    render(
      <Section title="Documents" titleClassName="custom-title">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { name: "Documents" }).className).toContain("custom-title");
  });

  it("merges a custom className", () => {
    render(
      <Section className="custom-class" data-testid="section">
        <p>Body content</p>
      </Section>,
    );
    expect(screen.getByTestId("section").className).toContain("custom-class");
  });
});
