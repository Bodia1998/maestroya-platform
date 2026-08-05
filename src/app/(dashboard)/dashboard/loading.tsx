import { Skeleton } from "@/components/ui/skeleton";
import { KPIGridSkeleton, PanelSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <KPIGridSkeleton count={4} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </div>
  );
}
