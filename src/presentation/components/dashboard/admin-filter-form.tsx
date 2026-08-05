import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";

export interface AdminFilterFormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "method" | "aria-label"> {
  /** Accessible name for the form landmark (e.g. "Search users", "Filter companies") — every admin list's GET search/filter form. */
  "aria-label": string;
  submitLabel?: string;
  children: React.ReactNode;
}

/**
 * The `<form method="get" className="flex gap-2">…<button>Search/Filter</button></form>`
 * shell hand-duplicated across every admin list page's search/filter bar
 * (users, professionals, companies, company-verifications, verifications,
 * disputes). Server-rendered (no "use client") — it's a plain GET form, the
 * same submit-and-reload pattern every one of those pages already used, just
 * with a consistent `aria-label`, wrap behavior on narrow screens, and a
 * real `Button` (focus ring, hover, disabled state) instead of a hand-rolled
 * `<button>`. Field markup (inputs/selects) stays page-owned since it varies.
 */
export function AdminFilterForm({
  "aria-label": ariaLabel,
  submitLabel = "Search",
  className,
  children,
  ...props
}: AdminFilterFormProps) {
  return (
    <form method="get" aria-label={ariaLabel} className={cn("flex flex-wrap items-center gap-2", className)} {...props}>
      {children}
      <Button type="submit" variant="outline" className="h-10 shrink-0">
        {submitLabel}
      </Button>
    </form>
  );
}
