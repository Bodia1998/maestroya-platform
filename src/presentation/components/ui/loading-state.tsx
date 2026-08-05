import { cn } from "@/shared/utils/cn";
import { Spinner } from "./spinner";

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Full-block loading placeholder for a page/section still fetching data — pairs with `EmptyState`/`ErrorState`. */
export function LoadingState({ label = "Cargando…", className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl px-6 py-16 text-center",
        className,
      )}
    >
      <Spinner size="lg" label={label} />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
