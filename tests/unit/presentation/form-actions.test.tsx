import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormActions } from "@/components/forms/form-actions";

describe("FormActions", () => {
  it("renders primary and secondary buttons", () => {
    render(
      <FormActions>
        <button type="button">Cancel</button>
        <button type="submit">Save</button>
      </FormActions>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("preserves the order buttons are given in the DOM", () => {
    render(
      <FormActions>
        <button type="button">Cancel</button>
        <button type="submit">Save</button>
      </FormActions>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Save"]);
  });

  it("is not sticky by default", () => {
    render(
      <FormActions>
        <button type="submit">Save</button>
      </FormActions>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.parentElement?.className).not.toMatch(/sticky/);
  });

  it("applies sticky-to-bottom-of-viewport behavior when stickyOnMobile is set", () => {
    render(
      <FormActions stickyOnMobile>
        <button type="submit">Save</button>
      </FormActions>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    // `sticky bottom-0` is the documented public contract of stickyOnMobile
    // (keeps the primary action reachable on long forms) — assert on those
    // specific utility classes rather than the whole incidental class list.
    expect(button.parentElement).toHaveClass("sticky", "bottom-0");
  });

  it("does not throw when rendered with no children", () => {
    expect(() => render(<FormActions />)).not.toThrow();
  });
});
