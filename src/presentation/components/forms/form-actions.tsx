import * as React from "react";

import { cn } from "@/shared/utils/cn";

export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Sticks the action row to the bottom of the viewport on mobile — use for long, scrollable forms. */
  stickyOnMobile?: boolean;
}

/**
 * Consistent footer action row for forms — primary submit + secondary
 * cancel/back, right-aligned on desktop, full-width stacked on mobile.
 * Optionally sticks to the bottom of the screen on small viewports so the
 * primary action stays reachable on long forms.
 */
export const FormActions = React.forwardRef<HTMLDivElement, FormActionsProps>(
  ({ className, stickyOnMobile, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end",
          stickyOnMobile &&
            "sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
FormActions.displayName = "FormActions";
