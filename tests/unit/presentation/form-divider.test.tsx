import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormDivider } from "@/components/forms/form-divider";

describe("FormDivider", () => {
  it("renders without throwing", () => {
    expect(() => render(<FormDivider />)).not.toThrow();
  });

  it("renders a decorative (aria-hidden) separator by default", () => {
    const { container } = render(<FormDivider />);
    const divider = container.querySelector('[role="none"]');
    expect(divider).toBeTruthy();
  });
});
