import { Skeleton } from "@/components/ui/skeleton";
import { ListSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>
      <ListSkeleton count={4} />
    </div>
  );
}
