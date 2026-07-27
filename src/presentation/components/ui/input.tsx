import * as React from "react";

import { cn } from "@/shared/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field as invalid — matches the `aria-invalid` styling hook below. */
  invalid?: boolean;
}

/**
 * Base text input primitive. Server-renderable (no "use client") since it
 * carries no local state of its own — forms that need controlled state
 * add "use client" at the form component level instead.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, "aria-invalid": ariaInvalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={ariaInvalid ?? invalid}
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base text-foreground shadow-xs transition-colors placeholder:text-muted-foreground hover:border-foreground/30 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger sm:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
