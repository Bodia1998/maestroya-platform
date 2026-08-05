"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/shared/utils/cn";
import { useDelayedUnmount } from "@/hooks/use-delayed-unmount";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  side?: "left" | "right";
}

/**
 * Slide-in side panel — `Dialog`'s sibling for mobile nav / filter panels
 * / detail-on-the-side use cases. Same portal + Escape + backdrop-click
 * + scroll-lock behavior as `Dialog`, just anchored to an edge.
 *
 * Bug fixed here: a `side="left"` drawer (the mobile nav in
 * `DashboardShell` — the single most-triggered drawer in the app) used to
 * cancel its own enter animation entirely (`animate-none`) because the
 * base class always applied `animate-slide-in-right`, which visually
 * contradicts a left-anchored panel. It now gets its own symmetric
 * `slide-in-left`/`slide-out-left` keyframes instead of no animation at
 * all. Exit animation via `useDelayedUnmount` — see that hook's doc
 * comment.
 */
export function Drawer({ open, onOpenChange, children, side = "right" }: DrawerProps) {
  const { shouldRender, closing } = useDelayedUnmount(open, 200);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (!shouldRender) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [shouldRender]);

  if (!shouldRender || typeof document === "undefined") return null;

  const enterClass = side === "right" ? "animate-slide-in-right" : "animate-slide-in-left";
  const exitClass = side === "right" ? "animate-slide-out-right" : "animate-slide-out-left";

  return createPortal(
    <div className="fixed inset-0 z-drawer flex">
      <div
        aria-hidden
        className={cn("absolute inset-0 bg-foreground/40 backdrop-blur-sm", closing ? "animate-fade-out" : "animate-fade-in")}
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex h-full w-full max-w-sm flex-col overflow-y-auto border-border bg-card p-6 shadow-xl",
          side === "right" ? "ml-auto border-l" : "mr-auto border-r",
          closing ? exitClass : enterClass,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function DrawerTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}

export function DrawerDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex justify-end gap-3 pt-6", className)} {...props} />;
}

export function DrawerClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Cerrar"
      className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
