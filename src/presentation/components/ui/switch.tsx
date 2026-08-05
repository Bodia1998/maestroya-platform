"use client";

import * as React from "react";

import { cn } from "@/shared/utils/cn";

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size">;

/** Toggle switch built on `<input type="checkbox" role="switch">` — native semantics, custom track/thumb via CSS. */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, ...props }, ref) => {
    return (
      <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center", className)}>
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          className="peer absolute inset-0 h-6 w-11 cursor-pointer appearance-none rounded-full border border-input bg-muted transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <span className="pointer-events-none relative left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    );
  },
);
Switch.displayName = "Switch";
