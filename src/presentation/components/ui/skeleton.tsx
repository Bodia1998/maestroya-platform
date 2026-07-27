import { cn } from "@/shared/utils/cn";

/** Loading placeholder — a shimmering block matching the shape of the content it stands in for. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gradient-to-r from-muted via-border/50 to-muted bg-[length:800px_100%]",
        className,
      )}
      {...props}
    />
  );
}
