import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No requests yet" />);
    expect(screen.getByText("No requests yet")).toBeTruthy();
  });

  it("renders an optional description", () => {
    render(<EmptyState title="No requests yet" description="Create your first request to get started." />);
    expect(screen.getByText("Create your first request to get started.")).toBeTruthy();
  });

  it("renders the primary action when provided", () => {
    render(<EmptyState title="No requests yet" action={<button type="button">New request</button>} />);
    expect(screen.getByRole("button", { name: "New request" })).toBeTruthy();
  });

  it("renders the secondary action alongside the primary action when both are provided", () => {
    render(
      <EmptyState
        title="No requests yet"
        action={<button type="button">New request</button>}
        secondaryAction={<button type="button">Learn more</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "New request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Learn more" })).toBeTruthy();
  });

  it("omits the secondary action when not passed", () => {
    render(<EmptyState title="No requests yet" action={<button type="button">New request</button>} />);
    expect(screen.queryByRole("button", { name: "Learn more" })).toBeNull();
  });

  it("renders a secondary action on its own, without a primary action", () => {
    render(<EmptyState title="No requests yet" secondaryAction={<button type="button">Learn more</button>} />);
    expect(screen.getByRole("button", { name: "Learn more" })).toBeTruthy();
  });
});
