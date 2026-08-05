"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/shared/utils/cn";

interface AccordionContextValue {
  openItems: Set<string>;
  toggle: (value: string) => void;
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

function useAccordionContext() {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error("Accordion.* components must be used inside <Accordion>");
  return ctx;
}

export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
}

/** FAQ-style expand/collapse group. `type="single"` (default) keeps at most one item open; `"multiple"` allows several. */
export function Accordion({ type = "single", defaultValue, className, children, ...props }: AccordionProps) {
  const initial = new Set(Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : []);
  const [openItems, setOpenItems] = React.useState<Set<string>>(initial);

  const toggle = React.useCallback(
    (value: string) => {
      setOpenItems((prev) => {
        const next = new Set(type === "single" ? [] : prev);
        if (prev.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return next;
      });
    },
    [type],
  );

  return (
    <AccordionContext.Provider value={{ openItems, toggle }}>
      <div className={cn("flex flex-col divide-y divide-border", className)} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

const AccordionItemContext = React.createContext<string | null>(null);

export function AccordionItem({
  value,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  return (
    <AccordionItemContext.Provider value={value}>
      <div className={cn("py-1", className)} {...props} />
    </AccordionItemContext.Provider>
  );
}

export function AccordionTrigger({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { openItems, toggle } = useAccordionContext();
  const value = React.useContext(AccordionItemContext);
  if (value === null) throw new Error("AccordionTrigger must be used inside <AccordionItem>");
  const isOpen = openItems.has(value);

  return (
    <button
      type="button"
      aria-expanded={isOpen}
      onClick={() => toggle(value)}
      className={cn(
        "flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        aria-hidden
        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
      />
    </button>
  );
}

export function AccordionContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { openItems } = useAccordionContext();
  const value = React.useContext(AccordionItemContext);
  if (value === null) throw new Error("AccordionContent must be used inside <AccordionItem>");
  const isOpen = openItems.has(value);
  if (!isOpen) return null;

  return (
    <div className={cn("animate-slide-down pb-3 text-sm text-muted-foreground", className)} {...props}>
      {children}
    </div>
  );
}
