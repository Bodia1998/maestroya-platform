import * as React from "react";

import { cn } from "@/shared/utils/cn";

export type FieldBadgeProps = React.HTMLAttributes<HTMLSpanElement>;

/** Small inline "Required" indicator for field labels — plain styled span, not interactive so it never competes with the label for the accessible name. */
export function RequiredBadge({ className, children, ...props }: FieldBadgeProps) {
  return (
    <span
      className={cn("text-xs font-medium text-danger", className)}
      aria-hidden="true"
      {...props}
    >
      {children ?? "*"}
    </span>
  );
}

/** Small inline "Optional" indicator for field labels. */
export function OptionalBadge({ className, children, ...props }: FieldBadgeProps) {
  return (
    <span
      className={cn(
        "rounded-full bg-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children ?? "Opcional"}
    </span>
  );
}
