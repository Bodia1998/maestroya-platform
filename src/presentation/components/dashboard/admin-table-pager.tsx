import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface AdminTablePagerProps {
  page: number;
  /** Whether another page is known to exist — admin list pages don't fetch a total count, only `results.length === pageSize`. */
  hasNextPage: boolean;
  /** Builds the href for a given page number, preserving any other query params (search/status/filter). */
  buildHref: (page: number) => string;
  className?: string;
}

/**
 * Server-rendered prev/next pager for admin list pages, styled to match the
 * Module 30.1 `Pagination` component (same chevron buttons, same focus
 * ring) — but link-based rather than `onPageChange`-callback-based, since
 * these pages are Server Components paginating via the URL's `?page=`
 * search param and never fetch a total row count (only "is there a full
 * page's worth of results", i.e. a next page might exist). A true numbered
 * `Pagination` would need a total count these use cases don't compute —
 * see the module 30.3 notes for that possible follow-up without touching
 * any use case/repository here.
 */
export function AdminTablePager({ page, hasNextPage, buildHref, className }: AdminTablePagerProps) {
  if (page <= 1 && !hasNextPage) return null;

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-between gap-2", className)}>
      {page > 1 ? (
        <Link
          href={buildHref(page - 1)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Previous
        </Link>
      ) : (
        <span aria-hidden />
      )}
      <span className="text-sm text-muted-foreground">Page {page}</span>
      {hasNextPage ? (
        <Link
          href={buildHref(page + 1)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </nav>
  );
}
