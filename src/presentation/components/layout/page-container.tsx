import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/shared/utils/cn";

/**
 * `mx-auto w-full max-w-* flex flex-col gap-*` — the wrapper every detail
 * page, form page, and standalone marketing page hand-rolls around its
 * content (see e.g. `(dashboard)/requests/[id]/page.tsx`,
 * `(dashboard)/jobs/[id]/page.tsx`, `(marketing)/companies/[id]/page.tsx`).
 * Centralized here so the handful of width/gap combinations actually used
 * across the app stay consistent instead of drifting page by page.
 */
const pageContainerVariants = cva("mx-auto flex w-full flex-col", {
  variants: {
    maxWidth: {
      "2xl": "max-w-2xl",
      "3xl": "max-w-3xl",
      "6xl": "max-w-6xl",
    },
    gap: {
      sm: "gap-6",
      md: "gap-8",
      lg: "gap-10",
    },
    /**
     * Pages rendered inside `DashboardShell` already get their outer
     * padding from the shell's `<main>` wrapper — only pages rendered
     * outside it (the public `(marketing)` routes) need their own
     * horizontal/vertical padding here.
     */
    padded: {
      true: "px-4 py-10",
      false: "",
    },
  },
  defaultVariants: {
    maxWidth: "2xl",
    gap: "md",
    padded: false,
  },
});

export interface PageContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof pageContainerVariants> {}

/** Centered max-width column used to lay out page-level content. */
export const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, maxWidth, gap, padded, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(pageContainerVariants({ maxWidth, gap, padded }), className)}
        {...props}
      />
    );
  },
);
PageContainer.displayName = "PageContainer";
