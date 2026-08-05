"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/shared/utils/cn";
import { Input, type InputProps } from "./input";

export interface SearchInputProps extends InputProps {
  /** Accessible label for the clear button, shown once there's a value. */
  clearLabel?: string;
  onClear?: () => void;
}

/** `Input` with a leading search icon and an optional clear button (shown once there's a value). */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, clearLabel = "Limpiar búsqueda", onClear, value, defaultValue, ...props }, ref) => {
    const hasValue = Boolean(value ?? defaultValue);
    return (
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={ref}
          type="search"
          value={value}
          defaultValue={defaultValue}
          className={cn("pl-10", hasValue && onClear && "pr-10", className)}
          {...props}
        />
        {hasValue && onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={clearLabel}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
