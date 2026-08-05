import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/shared/utils/cn";

/**
 * `<section className="flex flex-wrap gap-3 border-t border-border pt-6">`
 * — the trailing row of page-level actions (edit/cancel, accept/decline,
 * ...) separated from the content above by a rule. See e.g.
 * `(dashboard)/requests/[id]/page.tsx`,
 * `(dashboard)/dashboard/professional/quotes/[id]/page.tsx`,
 * `(dashboard)/dashboard/professional/requests/[id]/page.tsx`.
 */
const actionBarVariants = cva("flex flex-wrap gap-3 border-t border-border pt-6", {
  variants: {
    itemsCenter: {
      true: "items-center",
      false: "",
    },
  },
  defaultVariants: {
    itemsCenter: false,
  },
});

export interface ActionBarProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof actionBarVariants> {}

/** Bottom-of-page action row, visually separated from the content above it. */
export const ActionBar = React.forwardRef<HTMLDivElement, ActionBarProps>(
  ({ className, itemsCenter, ...props }, ref) => {
    return (
      <section
        ref={ref as unknown as React.Ref<HTMLElement>}
        className={cn(actionBarVariants({ itemsCenter }), className)}
        {...props}
      />
    );
  },
);
ActionBar.displayName = "ActionBar";
