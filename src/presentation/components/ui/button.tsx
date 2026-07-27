"use client";

import * as React from "react";

import { cn } from "@/shared/utils/cn";
import { type ButtonVariantProps, buttonVariants } from "./button-variants";

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
 * genuinely requires it. The variant/class-name recipe itself
 * (`buttonVariants`) lives in `./button-variants` precisely so it *isn't*
 * bound to this "use client" boundary — see that file's doc comment.
 *
 * Not re-exported from here: anything imported from `./button-variants`
 * directly (as `Button` does below) stays a plain function call; a
 * re-export through this "use client" module would put it right back
 * behind the same client boundary that caused the original bug. Server
 * Components that only need the class-name recipe (e.g. `ButtonLink`)
 * should import `buttonVariants` from `./button-variants` directly.
 */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariantProps {}

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
