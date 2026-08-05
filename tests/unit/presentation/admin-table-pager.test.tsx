import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminTablePager } from "@/components/dashboard/admin-table-pager";

const buildHref = (page: number) => `/admin/users?page=${page}`;

describe("AdminTablePager", () => {
  it("hides the Previous link on page 1", () => {
    render(<AdminTablePager page={1} hasNextPage buildHref={buildHref} />);
    expect(screen.queryByRole("link", { name: /previous/i })).toBeNull();
  });

  it("shows the Previous link linking to page - 1 when page > 1", () => {
    render(<AdminTablePager page={2} hasNextPage buildHref={buildHref} />);
    const prev = screen.getByRole("link", { name: /previous/i });
    expect(prev.getAttribute("href")).toBe("/admin/users?page=1");
  });

  it("hides the Next link when hasNextPage is false", () => {
    render(<AdminTablePager page={2} hasNextPage={false} buildHref={buildHref} />);
    expect(screen.queryByRole("link", { name: /^next$/i })).toBeNull();
  });

  it("shows the Next link linking to page + 1 when hasNextPage is true", () => {
    render(<AdminTablePager page={2} hasNextPage buildHref={buildHref} />);
    const next = screen.getByRole("link", { name: /next/i });
    expect(next.getAttribute("href")).toBe("/admin/users?page=3");
  });

  it("renders the current page number", () => {
    render(<AdminTablePager page={3} hasNextPage buildHref={buildHref} />);
    expect(screen.getByText("Page 3")).toBeTruthy();
  });

  it("renders nothing on page 1 with no next page", () => {
    const { container } = render(<AdminTablePager page={1} hasNextPage={false} buildHref={buildHref} />);
    expect(container.firstChild).toBeNull();
  });

  it("exposes a labeled Pagination navigation landmark when rendered", () => {
    render(<AdminTablePager page={2} hasNextPage buildHref={buildHref} />);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy();
  });
});
