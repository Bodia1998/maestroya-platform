import { Skeleton } from "@/components/ui/skeleton";
import { KPIGridSkeleton, PanelSkeleton } from "@/components/dashboard/skeletons";
import { PageContainer } from "@/components/layout/page-container";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";

export default function Loading() {
  return (
    <PageContainer maxWidth="6xl">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <KPIGridSkeleton count={4} />
      <ResponsiveGrid cols="1-2-lg" gap="lg">
        <PanelSkeleton />
        <PanelSkeleton />
      </ResponsiveGrid>
    </PageContainer>
  );
}
