import type { LucideIcon } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Primary call to action — typically a `ButtonLink`/`Button`. */
  action?: React.ReactNode;
  /** Optional secondary, less prominent action rendered next to `action`. */
  secondaryAction?: React.ReactNode;
  className?: string;
}

/** Consistent "nothing here yet" state — used across dashboards and list pages. */
export function EmptyState({ icon: Icon, title, description, action, secondaryAction, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-muted-foreground shadow-xs">
          <Icon aria-hidden className="h-6 w-6" />
        </span>
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
