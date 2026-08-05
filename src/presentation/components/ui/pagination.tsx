"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  labels?: { previous: string; next: string };
}

function getPageList(page: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("ellipsis");
    result.push(p);
    prev = p;
  }
  return result;
}

/** Numbered pagination control with ellipsis collapsing for long ranges. Fully keyboard-navigable buttons. */
export function Pagination({ page, totalPages, onPageChange, className, labels }: PaginationProps) {
  const items = getPageList(page, totalPages);
  const t = labels ?? { previous: "Anterior", next: "Siguiente" };

  return (
    <nav aria-label="Paginación" className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        aria-label={t.previous}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>

      {items.map((item, i) =>
        item === "ellipsis" ? (
          <span key={`ellipsis-${i}`} className="flex h-9 w-9 items-center justify-center text-muted-foreground">
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-current={item === page ? "page" : undefined}
            onClick={() => onPageChange(item)}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              item === page
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted",
            )}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        aria-label={t.next}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}
