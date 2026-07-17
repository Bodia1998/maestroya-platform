"use client";

import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/shared/utils/cn";

/**
 * Base Button primitive.
 *
 * This is the one example component in `ui/` establishing the pattern the
 * rest of the design system should follow: CVA for variants, `cn()` for
 * class merging, `forwardRef` so it composes with form libraries and
 * portals. It is deliberately generic (no marketplace-specific styling)
 * — real visual design comes later.
 *
 * Client Component because it needs interactivity (onClick, etc.) — most
 * components in this app should NOT have this directive; default to
 * Server Components and only opt into "use client" where interactivity
 * genuinely requires it.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border border-border bg-transparent hover:bg-black/5",
        ghost: "hover:bg-black/5",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
