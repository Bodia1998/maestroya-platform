import { Skeleton } from "@/components/ui/skeleton";
import { ListSkeleton } from "@/components/dashboard/skeletons";
import { PageContainer } from "@/components/layout/page-container";

export default function Loading() {
  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-11 w-32 rounded-md" />
      </div>
      <ListSkeleton count={4} />
    </PageContainer>
  );
}
