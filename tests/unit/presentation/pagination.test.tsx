import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "@/components/ui/pagination";

import { setTestLocale } from "../../test-utils/intl";

describe("Pagination", () => {
  it("renders every page number for a short range", () => {
    render(<Pagination page={1} totalPages={5} onPageChange={vi.fn()} />);

    for (const page of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole("button", { name: String(page) })).toBeTruthy();
    }
  });

  it("marks the current page with aria-current", () => {
    render(<Pagination page={3} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "3" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "2" }).getAttribute("aria-current")).toBeNull();
  });

  it("collapses a long range with ellipsis", () => {
    render(<Pagination page={10} totalPages={40} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "40" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "20" })).toBeNull();
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const { rerender } = render(<Pagination page={1} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();

    rerender(<Pagination page={5} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("calls onPageChange with the clicked page number", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole("button", { name: "4" }));

    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("calls onPageChange with page +/- 1 for Next/Previous", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("supports custom Previous/Next labels", () => {
    render(
      <Pagination
        page={1}
        totalPages={3}
        onPageChange={vi.fn()}
        labels={{ previous: "Prev", next: "Next" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Prev" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });

  it("localizes its default labels with the active locale (ru)", () => {
    setTestLocale("ru");
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("navigation", { name: "Пагинация" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Назад" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Далее" })).toBeTruthy();
  });
});
