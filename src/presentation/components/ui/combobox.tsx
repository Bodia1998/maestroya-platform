"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * Searchable single-select — `Select`'s sibling for large option lists
 * where a native `<select>`'s lack of in-list search is a real problem
 * (e.g. picking a service category or a city out of hundreds). Same
 * dependency-free approach as the rest of `ui/` (no cmdk/Radix): a plain
 * `role="listbox"` popover filtered client-side.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Selecciona una opción",
  searchPlaceholder = "Buscar…",
  emptyText = "Sin resultados",
  className,
  invalid,
  disabled,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = React.useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function commit(option: ComboboxOption) {
    onValueChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-md border border-input bg-background px-3.5 py-2 text-base text-foreground shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          invalid && "border-danger",
        )}
      >
        <span className={cn(!selected && "text-muted-foreground")}>{selected ? selected.label : placeholder}</span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-dropdown mt-2 w-full animate-scale-in rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            className="mb-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <ul role="listbox" className="max-h-60 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</li>
            )}
            {filtered.map((option, i) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(option)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    i === activeIndex ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  {option.label}
                  {option.value === value && <Check aria-hidden className="h-4 w-4 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
