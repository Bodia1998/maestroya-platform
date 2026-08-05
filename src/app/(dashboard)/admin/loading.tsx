import { Skeleton } from "@/components/ui/skeleton";
import { KPIGridSkeleton, TableSkeleton } from "@/components/dashboard/skeletons";

/**
 * Shared loading state for every `/admin/*` route (this Next.js `loading.tsx`
 * applies to the whole admin route segment). Renders both a KPI-grid shape
 * and a table shape stacked so it reasonably approximates whichever admin
 * page is actually loading — the overview page (KPI cards) or any of the
 * list pages (tables) beneath it.
 */
export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <KPIGridSkeleton count={4} />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
