import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/**
 * Native `<select>` styled to match the rest of the design system.
 *
 * Deliberately not a custom listbox component — a native select is fully
 * accessible and keyboard-operable for free, works without JS, and this
 * app has no dependency on Radix (or similar) to build a styled listbox
 * without a real chunk of new code. Revisit only if a concrete design
 * need (multi-select, search-as-you-type) requires it.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, "aria-invalid": ariaInvalid, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          aria-invalid={ariaInvalid ?? invalid}
          className={cn(
            "flex h-11 w-full appearance-none rounded-md border border-input bg-background px-3.5 py-2 pr-10 text-base text-foreground shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger sm:text-sm",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    );
  },
);
Select.displayName = "Select";
