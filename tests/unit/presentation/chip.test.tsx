import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Chip } from "@/components/ui/chip";

describe("Chip", () => {
  it("renders as a button with its children", () => {
    render(<Chip>Plumbing</Chip>);
    expect(screen.getByRole("button", { name: "Plumbing" })).toBeTruthy();
  });

  it("fires onClick when pressed", () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Plumbing</Chip>);

    fireEvent.click(screen.getByRole("button", { name: "Plumbing" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("reflects the selected state via aria-pressed", () => {
    const { rerender } = render(<Chip selected={false}>Plumbing</Chip>);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");

    rerender(<Chip selected>Plumbing</Chip>);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not render a remove affordance unless onRemove is provided", () => {
    render(<Chip>Plumbing</Chip>);
    expect(screen.queryByRole("button", { name: "Quitar" })).toBeNull();
  });

  it("renders a remove affordance and fires onRemove without triggering the chip's own onClick", () => {
    const onRemove = vi.fn();
    const onClick = vi.fn();
    render(
      <Chip onClick={onClick} onRemove={onRemove} removeLabel="Remove filter">
        Plumbing
      </Chip>,
    );

    fireEvent.click(screen.getByLabelText("Remove filter"));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
