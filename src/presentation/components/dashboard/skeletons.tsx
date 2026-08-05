import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** A single KPI-tile-shaped placeholder — matches `KPICard`'s markup. */
function KPICardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Row of KPI-tile placeholders — used by dashboard-overview-style loading states. */
export function KPIGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <KPICardSkeleton key={i} />
      ))}
    </div>
  );
}

/** A single list-item-card-shaped placeholder — matches the dashboard `cards/*` components' markup. */
function ListCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-4 w-1/3" />
    </Card>
  );
}

/** Stack of list-item-card placeholders — used by "My requests"/"My jobs"/"My appointments"/etc. loading states. */
export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <ListCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Section-card placeholder (header + a couple of content lines) — used for overview "panel" cards. */
export function PanelSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

/** Simple stacked-field form placeholder — used by profile/settings-style loading states. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Table placeholder — header row + a handful of body rows. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex gap-4 border-b border-border bg-muted/40 p-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 p-3">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
