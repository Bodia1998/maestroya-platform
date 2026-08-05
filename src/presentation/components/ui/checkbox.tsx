"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  invalid?: boolean;
}

/**
 * Styled checkbox built on a real `<input type="checkbox">` (visually
 * hidden but still hit-testable and keyboard/screen-reader operable) —
 * same "native control + CSS" approach as `Select`, no custom ARIA
 * widget needed.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, invalid, "aria-invalid": ariaInvalid, ...props }, ref) => {
    return (
      <span className={cn("relative inline-flex h-5 w-5 shrink-0 items-center justify-center", className)}>
        <input
          ref={ref}
          type="checkbox"
          aria-invalid={ariaInvalid ?? invalid}
          className="peer absolute inset-0 h-5 w-5 cursor-pointer appearance-none rounded-md border border-input bg-background shadow-xs transition-colors checked:border-primary checked:bg-primary hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger"
          {...props}
        />
        <Check
          aria-hidden
          className="pointer-events-none relative h-3.5 w-3.5 scale-0 text-primary-foreground transition-transform peer-checked:scale-100"
        />
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";
