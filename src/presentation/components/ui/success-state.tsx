import { CheckCircle2 } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface SuccessStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Full-block confirmation placeholder — e.g. "request submitted", "payment completed". Pairs with `EmptyState`/`ErrorState`. */
export function SuccessState({ title, description, action, className }: SuccessStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-success/20 bg-success-muted/40 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-success shadow-xs">
        <CheckCircle2 aria-hidden className="h-6 w-6" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
