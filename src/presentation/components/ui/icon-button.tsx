"use client";

import * as React from "react";

import { cn } from "@/shared/utils/cn";
import { type ButtonVariantProps, buttonVariants } from "./button-variants";

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size">,
    Omit<ButtonVariantProps, "size"> {
  /** Required — an icon-only control has no visible text, so this is its accessible name. */
  "aria-label": string;
  size?: "sm" | "default" | "lg";
}

const sizeToButtonSize = {
  sm: "h-9 w-9",
  default: "h-10 w-10",
  lg: "h-12 w-12",
} as const;

/** Icon-only Button — same variants as `Button`, square dimensions, mandatory `aria-label`. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          buttonVariants({ variant, size: "icon" }),
          sizeToButtonSize[size],
          "p-0",
          className,
        )}
        {...props}
      />
    );
  },
);
IconButton.displayName = "IconButton";
