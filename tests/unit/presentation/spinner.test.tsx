import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Spinner } from "@/components/ui/spinner";

describe("Spinner", () => {
  it("exposes a status role with a default accessible label", () => {
    render(<Spinner />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Cargando");
  });

  it("uses a custom accessible label", () => {
    render(<Spinner label="Loading professionals" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading professionals");
  });

  it("accepts every documented size without throwing", () => {
    expect(() => render(<Spinner size="sm" />)).not.toThrow();
    expect(() => render(<Spinner size="lg" />)).not.toThrow();
  });
});
