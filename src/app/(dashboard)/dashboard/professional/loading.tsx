import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton, PanelSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <PanelSkeleton />
      <FormSkeleton fields={5} />
    </div>
  );
}
