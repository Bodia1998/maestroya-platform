import { PageContainer } from "@/components/layout/page-container";
import { ListSkeleton } from "@/components/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-2 pb-6" aria-hidden>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <ListSkeleton count={4} />
    </PageContainer>
  );
}
