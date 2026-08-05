import { AlertTriangle } from "lucide-react";

import { cn } from "@/shared/utils/cn";
import { Button } from "./button";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/** Full-block error placeholder — pairs with `LoadingState`/`EmptyState` for a section that failed to load. */
export function ErrorState({
  title = "Algo salió mal",
  description,
  onRetry,
  retryLabel = "Reintentar",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-danger/30 bg-danger-muted/40 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-danger shadow-xs">
        <AlertTriangle aria-hidden className="h-6 w-6" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
