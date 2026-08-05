import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/shared/utils/cn";

export interface KPICardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  /** Optional secondary line under the value — e.g. "3 awaiting your reply". */
  subtext?: string;
  /**
   * Optional trend indicator. `value` is a signed percentage/count already
   * computed by the caller from data it already has — this component never
   * computes a trend itself. Positive shows an "up" arrow in the success
   * color, negative shows a "down" arrow in the danger color.
   */
  trend?: { value: number; label?: string };
  /** Makes the whole card a link — used for KPIs that route to their own list page. */
  href?: string;
  className?: string;
}

/**
 * Small metric tile — label, value, icon, optional trend/subtext. Reused
 * across every dashboard overview (customer, professional, company, admin)
 * for "Active requests", "Quotes awaiting response", etc. Supersedes the
 * narrower `DashboardStatCard` (kept as a thin wrapper around this for
 * backward compatibility — see dashboard-stat-card.tsx).
 *
 * Presentation-only: callers pass in a `value` from data they already
 * fetched — this component never fetches or computes anything itself.
 */
export function KPICard({ icon: Icon, label, value, subtext, trend, href, className }: KPICardProps) {
  const content = (
    <Card
      className={cn(
        "h-full shadow-sm transition-all hover:shadow-md",
        href && "hover:-translate-y-0.5 hover:border-primary/40",
        className,
      )}
    >
      <CardContent className="flex items-start gap-4 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold leading-none tabular-nums">{value}</p>
          <p className="mt-1.5 truncate text-sm text-muted-foreground">{label}</p>
          {(subtext || trend) && (
            <div className="mt-2 flex items-center gap-1.5">
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-medium",
                    trend.value > 0 && "text-success",
                    trend.value < 0 && "text-danger",
                    trend.value === 0 && "text-muted-foreground",
                  )}
                >
                  {trend.value > 0 && <TrendingUp className="h-3.5 w-3.5" aria-hidden />}
                  {trend.value < 0 && <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                  {trend.value > 0 ? "+" : ""}
                  {trend.value}
                  {trend.label ? ` ${trend.label}` : ""}
                </span>
              )}
              {subtext && <span className="truncate text-xs text-muted-foreground">{subtext}</span>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (!href) return content;

  return (
    <Link href={href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {content}
    </Link>
  );
}
