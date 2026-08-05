import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "@/components/ui/icon-button";

describe("IconButton", () => {
  it("renders a button whose accessible name comes from the required aria-label", () => {
    render(
      <IconButton aria-label="Open menu">
        <span aria-hidden>x</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy();
  });

  it("fires onClick when pressed", () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Notifications" onClick={onClick}>
        <span aria-hidden>bell</span>
      </IconButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects the disabled prop", () => {
    render(
      <IconButton aria-label="Notifications" disabled>
        <span aria-hidden>bell</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Notifications" })).toBeDisabled();
  });

  it("renders every documented size without throwing", () => {
    expect(() =>
      render(
        <IconButton aria-label="Small" size="sm">
          <span aria-hidden>x</span>
        </IconButton>,
      ),
    ).not.toThrow();
    expect(() =>
      render(
        <IconButton aria-label="Large" size="lg">
          <span aria-hidden>x</span>
        </IconButton>,
      ),
    ).not.toThrow();
  });
});
