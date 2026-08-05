"use client";

import * as React from "react";

import { cn } from "@/shared/utils/cn";

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) throw new Error("Popover.* components must be used inside <Popover>");
  return ctx;
}

export interface PopoverProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Lightweight, dependency-free popover — same pattern as `Dialog`/`Tabs`
 * (no Radix in this project). Positions its content relative to the
 * trigger via plain CSS (`absolute` + a wrapping `relative` root), closes
 * on outside click and Escape.
 */
export function Popover({ open: controlledOpen, defaultOpen = false, onOpenChange, children }: PopoverProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const setOpen = React.useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
      <div ref={rootRef} className="relative inline-block">
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

export function PopoverTrigger({
  asChild,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { open, setOpen, triggerRef } = usePopoverContext();

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<Record<string, unknown>>,
      {
        ref: triggerRef,
        "aria-expanded": open,
        onClick: (e: React.MouseEvent) => {
          (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
          setOpen(!open);
        },
      },
    );
  }

  return (
    <button
      type="button"
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {children}
    </button>
  );
}

export interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
}

export function PopoverContent({ className, align = "start", side = "bottom", ...props }: PopoverContentProps) {
  const { open } = usePopoverContext();
  if (!open) return null;

  const alignClass = { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" }[align];
  const sideClass = side === "bottom" ? "top-full mt-2" : "bottom-full mb-2";

  return (
    <div
      role="dialog"
      className={cn(
        "absolute z-popover w-72 animate-scale-in rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg",
        alignClass,
        sideClass,
        className,
      )}
      {...props}
    />
  );
}
