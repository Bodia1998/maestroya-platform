import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorState } from "@/components/ui/error-state";

describe("ErrorState", () => {
  it("renders the default title as an alert", () => {
    render(<ErrorState />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Algo salió mal");
  });

  it("renders a custom title and description", () => {
    render(<ErrorState title="Could not load requests" description="Please try again." />);
    expect(screen.getByText("Could not load requests")).toBeTruthy();
    expect(screen.getByText("Please try again.")).toBeTruthy();
  });

  it("does not render a retry button when onRetry is omitted", () => {
    render(<ErrorState />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a retry button and fires onRetry when clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} retryLabel="Try again" />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
