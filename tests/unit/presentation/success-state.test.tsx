import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SuccessState } from "@/components/ui/success-state";

describe("SuccessState", () => {
  it("renders the required title", () => {
    render(<SuccessState title="Request submitted" />);
    expect(screen.getByText("Request submitted")).toBeTruthy();
  });

  it("renders an optional description", () => {
    render(<SuccessState title="Payment completed" description="A receipt was emailed to you." />);
    expect(screen.getByText("A receipt was emailed to you.")).toBeTruthy();
  });

  it("renders an optional action node", () => {
    render(<SuccessState title="Done" action={<button type="button">Back to dashboard</button>} />);
    expect(screen.getByRole("button", { name: "Back to dashboard" })).toBeTruthy();
  });

  it("does not throw when description/action are omitted", () => {
    expect(() => render(<SuccessState title="Only a title" />)).not.toThrow();
  });
});
