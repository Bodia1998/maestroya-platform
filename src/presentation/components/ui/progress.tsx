import * as React from "react";

import { cn } from "@/shared/utils/cn";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–100. */
  value: number;
  max?: number;
}

/** Determinate progress bar — native `role="progressbar"` semantics, server-renderable. */
export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
        {...props}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-slow ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";
