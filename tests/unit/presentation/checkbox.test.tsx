import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("renders an unchecked native checkbox by default", () => {
    render(<Checkbox aria-label="Accept terms" />);
    const checkbox = screen.getByRole("checkbox", { name: "Accept terms" });
    expect(checkbox).not.toBeChecked();
  });

  it("toggles checked state and fires onChange when clicked", () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Accept terms" onChange={onChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "Accept terms" });
    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(checkbox).toBeChecked();
  });

  it("respects a controlled checked prop", () => {
    render(<Checkbox aria-label="Accept terms" checked readOnly />);
    expect(screen.getByRole("checkbox", { name: "Accept terms" })).toBeChecked();
  });

  it("is keyboard-focusable and not disabled by default", () => {
    render(<Checkbox aria-label="Accept terms" />);
    const checkbox = screen.getByRole("checkbox", { name: "Accept terms" });
    checkbox.focus();
    expect(document.activeElement).toBe(checkbox);
  });

  it("respects the disabled prop", () => {
    render(<Checkbox aria-label="Accept terms" disabled />);
    expect(screen.getByRole("checkbox", { name: "Accept terms" })).toBeDisabled();
  });

  it("marks aria-invalid when invalid is set", () => {
    render(<Checkbox aria-label="Accept terms" invalid />);
    expect(screen.getByRole("checkbox", { name: "Accept terms" }).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});
