import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchInput } from "@/components/ui/search-input";

describe("SearchInput", () => {
  it("renders a search-type input", () => {
    render(<SearchInput aria-label="Search" />);
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
  });

  it("does not render a clear button with no value", () => {
    render(<SearchInput aria-label="Search" onClear={vi.fn()} value="" onChange={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a clear button once there is a value, and fires onClear", () => {
    const onClear = vi.fn();
    render(<SearchInput aria-label="Search" value="plumber" onChange={vi.fn()} onClear={onClear} />);

    const clearButton = screen.getByRole("button", { name: "Limpiar búsqueda" });
    fireEvent.click(clearButton);

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not render a clear button when onClear is omitted, even with a value", () => {
    render(<SearchInput aria-label="Search" value="plumber" onChange={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets the user type into the field", () => {
    const onChange = vi.fn();
    render(<SearchInput aria-label="Search" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "electrician" } });

    expect(onChange).toHaveBeenCalled();
  });

  it("supports a custom clear label", () => {
    render(
      <SearchInput aria-label="Search" value="x" onChange={vi.fn()} onClear={vi.fn()} clearLabel="Reset" />,
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });
});
