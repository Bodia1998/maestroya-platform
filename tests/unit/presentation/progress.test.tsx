import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("exposes progressbar semantics with the current value", () => {
    render(<Progress value={40} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("respects a custom max", () => {
    render(<Progress value={5} max={10} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("10");
  });

  it("clamps the rendered fill to [0, 100]%", () => {
    // The fill's `width` is a constant 100% (Module 30.8 — animating it via
    // a GPU-friendly `transform: scaleX()` instead of the `width` property
    // avoids layout thrashing), so the clamped value now shows up in
    // `transform` rather than `width`.
    const { rerender } = render(<Progress value={150} />);
    const fill = screen.getByRole("progressbar").querySelector("div") as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(fill.style.transform).toBe("scaleX(1)");

    rerender(<Progress value={-20} />);
    const fillNegative = screen.getByRole("progressbar").querySelector("div") as HTMLElement;
    expect(fillNegative.style.width).toBe("100%");
    expect(fillNegative.style.transform).toBe("scaleX(0)");
  });
});
