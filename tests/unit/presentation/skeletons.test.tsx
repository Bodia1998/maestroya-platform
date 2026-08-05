import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FormSkeleton,
  KPIGridSkeleton,
  ListSkeleton,
  PanelSkeleton,
  TableSkeleton,
} from "@/components/dashboard/skeletons";

/** All skeleton placeholder blocks share the `animate-pulse` class from the base `Skeleton` primitive. */
const countPulses = (container: HTMLElement) => container.querySelectorAll(".animate-pulse").length;

describe("dashboard skeletons", () => {
  it("KPIGridSkeleton renders without throwing and produces one tile's worth of placeholders per count", () => {
    const { container } = render(<KPIGridSkeleton count={4} />);
    expect(countPulses(container)).toBe(4 * 3); // icon + value + label per tile
  });

  it("KPIGridSkeleton defaults to 4 tiles", () => {
    const { container } = render(<KPIGridSkeleton />);
    expect(countPulses(container)).toBe(4 * 3);
  });

  it("ListSkeleton renders without throwing and produces one row's worth of placeholders per count", () => {
    const { container } = render(<ListSkeleton count={3} />);
    expect(countPulses(container)).toBe(3 * 3); // title + badge + subline per row
  });

  it("PanelSkeleton renders without throwing and produces a reasonable number of placeholders", () => {
    const { container } = render(<PanelSkeleton />);
    expect(countPulses(container)).toBeGreaterThan(0);
  });

  it("FormSkeleton renders one label+input placeholder pair per field", () => {
    const { container } = render(<FormSkeleton fields={5} />);
    expect(countPulses(container)).toBe(5 * 2);
  });

  it("TableSkeleton renders a header placeholder per column plus a cell placeholder per row per column", () => {
    const { container } = render(<TableSkeleton rows={3} columns={4} />);
    expect(countPulses(container)).toBe(4 + 3 * 4);
  });

  it("does not throw when every skeleton is rendered together", () => {
    expect(() =>
      render(
        <>
          <KPIGridSkeleton />
          <ListSkeleton />
          <PanelSkeleton />
          <FormSkeleton />
          <TableSkeleton />
        </>,
      ),
    ).not.toThrow();
  });
});
