import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/shared/utils/cn";

/**
 * The handful of `grid grid-cols-* gap-*` combinations hand-rolled across
 * detail pages (key/value fact grids — e.g. `(dashboard)/jobs/[id]/page.tsx`,
 * `(dashboard)/appointments/[id]/page.tsx`) and dashboard overview pages
 * (KPI card rows — e.g. `(dashboard)/dashboard/page.tsx`,
 * `(dashboard)/admin/page.tsx`). Tailwind can't generate classes from
 * interpolated strings, so every combination actually used in the app is
 * spelled out as its own `cols` variant rather than computed from a number.
 *
 * `bordered` covers the dense "fact grid" card look (`rounded-md border
 * border-border p-4 text-sm`) so the whole thing stays a single element,
 * matching the markup it replaces (a lone `<dl>` or `<section>`) instead of
 * introducing an extra wrapping `<div>`.
 */
const responsiveGridVariants = cva("grid", {
  variants: {
    cols: {
      /** Static two columns at every breakpoint. */
      "2": "grid-cols-2",
      /** One column on mobile, two from `sm` up. */
      "1-2": "grid-cols-1 sm:grid-cols-2",
      /** One column on mobile, two from `lg` up (no `sm` step). */
      "1-2-lg": "grid-cols-1 lg:grid-cols-2",
      /** One column on mobile, two from `sm`, four from `lg` up. */
      "1-2-4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
    },
    gap: {
      sm: "gap-3",
      md: "gap-4",
      lg: "gap-6",
    },
    bordered: {
      true: "rounded-md border border-border p-4 text-sm",
      false: "",
    },
  },
  defaultVariants: {
    cols: "1-2",
    gap: "md",
    bordered: false,
  },
});

export interface ResponsiveGridProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof responsiveGridVariants> {
  /** Element rendered — `"dl"` for key/value fact grids, `"div"` otherwise. */
  as?: "div" | "dl" | "section" | "ul";
}

/** Responsive grid wrapper covering the fixed set of column layouts used across the app. */
export const ResponsiveGrid = React.forwardRef<HTMLDivElement, ResponsiveGridProps>(
  ({ className, cols, gap, bordered, as = "div", ...props }, ref) => {
    const Tag = as as "div";
    return (
      <Tag
        ref={ref}
        className={cn(responsiveGridVariants({ cols, gap, bordered }), className)}
        {...props}
      />
    );
  },
);
ResponsiveGrid.displayName = "ResponsiveGrid";
