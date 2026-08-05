import * as React from "react";

import { Text, Heading } from "@/components/ui/typography";
import { cn } from "@/shared/utils/cn";

export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Optional trailing content next to the title — e.g. an OptionalBadge or a small action link. */
  titleAside?: React.ReactNode;
}

/**
 * Titled wrapper for a group of related form fields. Used to break long
 * forms (onboarding, profile, request creation) into scannable chunks with
 * a consistent heading style and spacing. Presentation-only — never touches
 * field values or validation.
 */
export const FormSection = React.forwardRef<HTMLDivElement, FormSectionProps>(
  ({ className, title, description, titleAside, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("flex flex-col gap-4", className)} {...props}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <Heading as="h2" level="h6" className="text-foreground">
              {title}
            </Heading>
            {titleAside}
          </div>
          {description && (
            <Text size="sm" tone="muted">
              {description}
            </Text>
          )}
        </div>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    );
  },
);
FormSection.displayName = "FormSection";
