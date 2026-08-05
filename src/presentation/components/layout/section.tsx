import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/shared/utils/cn";

/**
 * `<section className="flex flex-col gap-*">` with an optional
 * `<h2 className="text-lg font-medium">` title — the block every detail
 * page uses to group related content ("Description", "Photos", "Documents",
 * "Review actions", ...). See e.g. `(dashboard)/jobs/[id]/page.tsx`,
 * `(dashboard)/requests/[id]/page.tsx`, `(dashboard)/profile/page.tsx`.
 *
 * `bordered` covers the denser "card" variant of the same block (a
 * `rounded-md border border-border p-4` box, e.g. the "Review actions" and
 * "Invite a member" sections) and `divider` covers the "separated from the
 * section above by a rule" variant (e.g. the danger-zone section on the
 * profile page, or the trailing actions on the request edit page) — both
 * previously hand-rolled per page alongside the same title/content shape.
 */
const sectionVariants = cva("flex flex-col", {
  variants: {
    gap: {
      sm: "gap-2",
      md: "gap-3",
      lg: "gap-4",
    },
    bordered: {
      true: "rounded-md border border-border p-4",
      false: "",
    },
    divider: {
      true: "border-t border-border pt-6",
      false: "",
    },
  },
  defaultVariants: {
    gap: "md",
    bordered: false,
    divider: false,
  },
});

export interface SectionProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof sectionVariants> {
  /** Optional section title, rendered as an `<h2>`. */
  title?: React.ReactNode;
  /** Applies destructive styling to the title — used for "danger zone" sections. */
  titleTone?: "default" | "danger";
  titleClassName?: string;
}

/** Titled (or untitled) content grouping used throughout detail pages. */
export const Section = React.forwardRef<HTMLDivElement, SectionProps>(
  (
    {
      className,
      gap,
      bordered,
      divider,
      title,
      titleTone = "default",
      titleClassName,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <section
        ref={ref as unknown as React.Ref<HTMLElement>}
        className={cn(sectionVariants({ gap, bordered, divider }), className)}
        {...props}
      >
        {title && (
          <h2
            className={cn(
              "text-lg font-medium",
              titleTone === "danger" && "text-danger",
              titleClassName,
            )}
          >
            {title}
          </h2>
        )}
        {children}
      </section>
    );
  },
);
Section.displayName = "Section";
