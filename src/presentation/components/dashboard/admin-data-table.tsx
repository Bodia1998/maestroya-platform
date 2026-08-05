import type * as React from "react";

import { cn } from "@/shared/utils/cn";

/**
 * The `overflow-x-auto rounded-xl border border-border` + `table w-full
 * border-collapse text-sm` shell hand-duplicated across every `/admin/*`
 * list page's table (users, professionals, companies, company-verifications,
 * verifications, service-requests, quotes, jobs, reviews, portfolio,
 * audit-logs, disputes, support-tickets). Pulled out purely for the visual
 * shell + accessible name — it renders a visually-hidden `<caption>` (screen
 * readers announce it as the table's name; sighted users still see just the
 * `PageHeader` title above it) and lets each page keep authoring its own
 * `<thead>`/`<tbody>` via `AdminTableHeadRow`/`AdminTh`/`AdminTableBody`/
 * `AdminTableRow` below, since cell content differs per page.
 */
export interface AdminDataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the table, rendered as a visually-hidden `<caption>` (e.g. "Users"). */
  caption: string;
  /** Minimum content width (px) before the container scrolls horizontally — matches each page's previous `min-w-[…]` value. */
  minWidth?: number;
  children: React.ReactNode;
}

export function AdminDataTable({ caption, minWidth = 480, className, children, ...props }: AdminDataTableProps) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border", className)} {...props}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** Standard `<thead>` row — light background, uppercase muted label styling, used by every admin table. */
export function AdminTableHeadRow({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </tr>
    </thead>
  );
}

/** Header cell with `scope="col"` — every admin table's columns are simple row-per-record, so `col` is always correct here. */
export function AdminTh({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("px-4 py-3", className)} {...props} />;
}

export function AdminTableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border/50", className)} {...props} />;
}

export function AdminTableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-muted/40", className)} {...props} />;
}
