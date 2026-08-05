import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Separator } from "@/components/ui/separator";

describe("Separator", () => {
  it("is decorative (role='none', no orientation) by default", () => {
    const { container } = render(<Separator />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("role")).toBe("none");
    expect(el.getAttribute("aria-orientation")).toBeNull();
  });

  it("exposes a semantic separator role when decorative is false", () => {
    const { container } = render(<Separator decorative={false} />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("reflects the vertical orientation when non-decorative", () => {
    const { container } = render(<Separator decorative={false} orientation="vertical" />);
    expect(container.firstElementChild!.getAttribute("aria-orientation")).toBe("vertical");
  });
});
