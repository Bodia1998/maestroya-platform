import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "@/components/ui/switch";

describe("Switch", () => {
  it("renders as a native switch role", () => {
    render(<Switch aria-label="Enable notifications" />);
    expect(screen.getByRole("switch", { name: "Enable notifications" })).toBeTruthy();
  });

  it("is unchecked by default and toggles on click", () => {
    const onChange = vi.fn();
    render(<Switch aria-label="Enable notifications" onChange={onChange} />);

    const toggle = screen.getByRole("switch", { name: "Enable notifications" });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(toggle).toBeChecked();
  });

  it("respects a controlled checked prop", () => {
    render(<Switch aria-label="Enable notifications" checked readOnly />);
    expect(screen.getByRole("switch", { name: "Enable notifications" })).toBeChecked();
  });

  it("respects the disabled prop", () => {
    render(<Switch aria-label="Enable notifications" disabled />);
    expect(screen.getByRole("switch", { name: "Enable notifications" })).toBeDisabled();
  });
});
