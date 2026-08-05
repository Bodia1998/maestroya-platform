import { Skeleton } from "@/components/ui/skeleton";
import { ListSkeleton, PanelSkeleton } from "@/components/dashboard/skeletons";
import { PageContainer } from "@/components/layout/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <ListSkeleton count={2} />
      <PanelSkeleton />
    </PageContainer>
  );
}
