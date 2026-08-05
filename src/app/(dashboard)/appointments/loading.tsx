import { Skeleton } from "@/components/ui/skeleton";
import { ListSkeleton } from "@/components/dashboard/skeletons";
import { PageContainer } from "@/components/layout/page-container";

export default function Loading() {
  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <ListSkeleton count={4} />
    </PageContainer>
  );
}
