import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OptionalBadge, RequiredBadge } from "@/components/forms/field-badges";

describe("RequiredBadge", () => {
  it("renders a visible '*' by default", () => {
    render(<RequiredBadge />);
    expect(screen.getByText("*")).toBeTruthy();
  });

  it("is aria-hidden so it never competes with the field label for the accessible name", () => {
    const { container } = render(<RequiredBadge />);
    const badge = container.querySelector("span");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders custom children when provided", () => {
    render(<RequiredBadge>Required</RequiredBadge>);
    expect(screen.getByText("Required")).toBeTruthy();
  });
});

describe("OptionalBadge", () => {
  it("renders 'Opcional' by default", () => {
    render(<OptionalBadge />);
    expect(screen.getByText("Opcional")).toBeTruthy();
  });

  it("renders custom children when provided", () => {
    render(<OptionalBadge>Optional</OptionalBadge>);
    expect(screen.getByText("Optional")).toBeTruthy();
  });

  it("is not aria-hidden (unlike RequiredBadge, it is not paired with a visible '*')", () => {
    const { container } = render(<OptionalBadge />);
    const badge = container.querySelector("span");
    expect(badge?.getAttribute("aria-hidden")).toBeNull();
  });
});
