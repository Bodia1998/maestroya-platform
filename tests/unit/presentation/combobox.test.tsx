import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

const OPTIONS: ComboboxOption[] = [
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "carpentry", label: "Carpentry" },
];

describe("Combobox", () => {
  it("renders the placeholder when no value is selected", () => {
    render(<Combobox options={OPTIONS} onValueChange={vi.fn()} placeholder="Pick a category" />);
    expect(screen.getByRole("button", { name: /Pick a category/ })).toBeTruthy();
  });

  it("renders the selected option's label", () => {
    render(<Combobox options={OPTIONS} value="electrical" onValueChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Electrical/ })).toBeTruthy();
  });

  it("opens a listbox of options on trigger click", () => {
    render(<Combobox options={OPTIONS} onValueChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters options as the user types in the search field", () => {
    render(<Combobox options={OPTIONS} onValueChange={vi.fn()} searchPlaceholder="Buscar…" />);
    fireEvent.click(screen.getByRole("button"));

    fireEvent.change(screen.getByPlaceholderText("Buscar…"), { target: { value: "elec" } });

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Electrical" })).toBeTruthy();
  });

  it("shows the empty-state text when no option matches", () => {
    render(<Combobox options={OPTIONS} onValueChange={vi.fn()} emptyText="No results" />);
    fireEvent.click(screen.getByRole("button"));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzz" } });

    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("commits a value on option click and closes the popover", () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole("button"));

    fireEvent.click(screen.getByRole("option", { name: "Carpentry" }));

    expect(onValueChange).toHaveBeenCalledWith("carpentry");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("commits the active option on Enter", () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole("button"));

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledWith("electrical");
  });

  it("closes on Escape without committing a value", () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole("button"));

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("does not open when disabled", () => {
    render(<Combobox options={OPTIONS} onValueChange={vi.fn()} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
