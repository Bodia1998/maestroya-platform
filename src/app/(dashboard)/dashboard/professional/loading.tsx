import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton, PanelSkeleton } from "@/components/dashboard/skeletons";
import { PageContainer } from "@/components/layout/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <PanelSkeleton />
      <FormSkeleton fields={5} />
    </PageContainer>
  );
}
