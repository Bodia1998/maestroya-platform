"use client";

import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/shared/utils/cn";

const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-foreground",
        primary: "border-transparent bg-primary/10 text-primary",
        accent: "border-transparent bg-accent/15 text-accent-foreground",
      },
      selected: {
        true: "",
        false: "",
      },
    },
    defaultVariants: { variant: "default", selected: false },
  },
);

export interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {
  /** Shows a trailing remove (×) affordance and fires this on click. Omit for a plain selectable chip. */
  onRemove?: () => void;
  removeLabel?: string;
}

/**
 * Interactive filter/tag chip — a `<button>` (unlike the static `Badge`),
 * for things like removable search filters or multi-select tag pickers.
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, variant, selected, onRemove, removeLabel = "Quitar", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected ?? undefined}
        className={cn(
          chipVariants({ variant, selected }),
          selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          className,
        )}
        {...props}
      >
        {children}
        {onRemove && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={removeLabel}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="-mr-1 rounded-full p-0.5 hover:bg-foreground/10"
          >
            <X aria-hidden className="h-3 w-3" />
          </span>
        )}
      </button>
    );
  },
);
Chip.displayName = "Chip";
