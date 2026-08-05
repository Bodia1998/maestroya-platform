import * as React from "react";
import { Loader2 } from "lucide-react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/shared/utils/cn";

const spinnerVariants = cva("animate-spin-slow text-muted-foreground", {
  variants: {
    size: {
      sm: "h-4 w-4",
      default: "h-6 w-6",
      lg: "h-8 w-8",
    },
  },
  defaultVariants: { size: "default" },
});

export interface SpinnerProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof spinnerVariants> {
  /** Accessible label — spinners have no visible text. Defaults to "Cargando". */
  label?: string;
}

export function Spinner({ className, size, label = "Cargando", ...props }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex" {...props}>
      <Loader2 aria-hidden className={cn(spinnerVariants({ size }), className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
