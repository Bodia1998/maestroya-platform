import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoadingState } from "@/components/ui/loading-state";

describe("LoadingState", () => {
  it("renders the default label", () => {
    render(<LoadingState />);
    expect(screen.getAllByText("Cargando…").length).toBeGreaterThan(0);
  });

  it("renders a custom label and exposes a status role for the spinner", () => {
    render(<LoadingState label="Loading requests…" />);
    expect(screen.getAllByText("Loading requests…").length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
