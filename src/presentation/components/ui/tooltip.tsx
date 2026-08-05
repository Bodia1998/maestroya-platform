"use client";

import * as React from "react";

import { cn } from "@/shared/utils/cn";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  /** Delay before showing, in ms — avoids flicker on fast mouse-throughs. */
  delayMs?: number;
}

const sideClass: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

let idCounter = 0;

/**
 * Dependency-free tooltip. Shows on hover/focus (keyboard users get it
 * too, via `onFocus`/`onBlur`), wired via `aria-describedby` rather than
 * a portal so it stays simple — fine for the short, non-interactive
 * hints this is meant for.
 */
export function Tooltip({ content, children, side = "top", delayMs = 200 }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = React.useRef(`tooltip-${++idCounter}`).current;

  const show = () => {
    timeoutRef.current = setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  React.useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const child = React.cloneElement(children, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      (children.props as { onMouseEnter?: (e: React.MouseEvent) => void }).onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (children.props as { onMouseLeave?: (e: React.MouseEvent) => void }).onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      (children.props as { onFocus?: (e: React.FocusEvent) => void }).onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      (children.props as { onBlur?: (e: React.FocusEvent) => void }).onBlur?.(e);
      hide();
    },
  } as Record<string, unknown>);

  return (
    <span className="relative inline-block">
      {child}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "pointer-events-none absolute z-tooltip animate-fade-in whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md",
            sideClass[side],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
