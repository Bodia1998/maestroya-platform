import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

function renderGroup(value: string | undefined, onValueChange = vi.fn()) {
  return {
    onValueChange,
    ...render(
      <RadioGroup name="plan" value={value} onValueChange={onValueChange}>
        <label>
          <RadioGroupItem value="basic" /> Basic
        </label>
        <label>
          <RadioGroupItem value="pro" /> Pro
        </label>
      </RadioGroup>,
    ),
  };
}

describe("RadioGroup", () => {
  it("exposes a radiogroup role wrapping native radio inputs", () => {
    renderGroup("basic");
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("marks the option matching the controlled value as checked", () => {
    renderGroup("pro");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.find((r) => r.value === "pro")).toHaveProperty("checked", true);
    expect(radios.find((r) => r.value === "basic")).toHaveProperty("checked", false);
  });

  it("calls onValueChange with the selected value", () => {
    const { onValueChange } = renderGroup("basic");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const pro = radios.find((r) => r.value === "pro")!;

    fireEvent.click(pro);

    expect(onValueChange).toHaveBeenCalledWith("pro");
  });

  it("shares one name across all items so only one can be selected", () => {
    renderGroup("basic");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const names = new Set(radios.map((r) => r.name));
    expect(names.size).toBe(1);
  });

  it("throws when RadioGroupItem is rendered outside RadioGroup", () => {
    // Suppress the expected React error-boundary console noise for this
    // specific negative case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<RadioGroupItem value="orphan" />)).toThrow();
    spy.mockRestore();
  });
});
