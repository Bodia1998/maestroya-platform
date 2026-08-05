import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton } from "@/components/dashboard/skeletons";
import { PageContainer } from "@/components/layout/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <FormSkeleton fields={4} />
    </PageContainer>
  );
}
