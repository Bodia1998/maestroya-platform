"use client";

import * as React from "react";

import { cn } from "@/shared/utils/cn";

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenu.* components must be used inside <DropdownMenu>");
  return ctx;
}

export interface DropdownMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Dependency-free dropdown/action menu — same hand-rolled approach as the
 * rest of `ui/` (see `Popover`, `Dialog`, `Tabs`). This is `UserMenu`'s
 * pattern (outside-click + Escape to close) generalized into a reusable
 * primitive with a `role="menu"` / `role="menuitem"` structure.
 */
export function DropdownMenu({ open: controlledOpen, onOpenChange, children }: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
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
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div ref={rootRef} className="relative inline-block text-left">
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { open, setOpen } = useDropdownMenuContext();

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      "aria-haspopup": "menu",
      "aria-expanded": open,
      onClick: (e: React.MouseEvent) => {
        (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
        setOpen(!open);
      },
    });
  }

  return (
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} {...props}>
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
}

export function DropdownMenuContent({ className, align = "end", ...props }: DropdownMenuContentProps) {
  const { open } = useDropdownMenuContext();
  if (!open) return null;
  return (
    <div
      role="menu"
      className={cn(
        "absolute z-dropdown mt-2 w-56 animate-scale-in rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
      {...props}
    />
  );
}

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean;
}

export function DropdownMenuItem({ className, destructive, onClick, ...props }: DropdownMenuItemProps) {
  const { setOpen } = useDropdownMenuContext();
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        destructive ? "text-danger hover:bg-danger-muted" : "text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn("my-1.5 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-3 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
  );
}
