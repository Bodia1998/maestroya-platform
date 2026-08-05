import * as React from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/shared/utils/cn";

export type FormDividerProps = React.HTMLAttributes<HTMLDivElement>;

/** Thin visual divider between form sections — thin wrapper around `Separator` with form-appropriate vertical rhythm. */
export const FormDivider = React.forwardRef<HTMLDivElement, FormDividerProps>(
  ({ className, ...props }, ref) => (
    <Separator ref={ref} className={cn("my-2", className)} {...props} />
  ),
);
FormDivider.displayName = "FormDivider";
