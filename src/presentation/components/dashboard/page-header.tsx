import type * as React from "react";

import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { Heading, Text } from "@/components/ui/typography";
import { cn } from "@/shared/utils/cn";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional breadcrumb trail rendered above the title — see `Breadcrumb`. */
  breadcrumbs?: BreadcrumbItem[];
  /** Right-aligned (wraps to below the title on narrow screens) action buttons. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standard dashboard page header — title, optional subtitle, optional
 * breadcrumb trail, and an actions slot. Pulled out of the many
 * hand-rolled `<h1>`/`<p>` pairs across `(dashboard)` pages so every page
 * that adopts it gets the same spacing/typography for free, via the
 * existing `Typography`/`Breadcrumb` design-system primitives — no new
 * visual language introduced here.
 */
export function PageHeader({ title, subtitle, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumb items={breadcrumbs} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading as="h1" level="h4">
            {title}
          </Heading>
          {subtitle && (
            <Text as="p" size="sm" tone="muted">
              {subtitle}
            </Text>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
