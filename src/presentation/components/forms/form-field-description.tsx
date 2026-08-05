import * as React from "react";

import { cn } from "@/shared/utils/cn";

export type FormFieldDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

/**
 * Small helper text under a field (e.g. "We'll only use this to contact
 * you"). Give it an `id` and pass that id to the field's `aria-describedby`
 * so assistive tech announces it alongside the field.
 */
export const FormFieldDescription = React.forwardRef<HTMLParagraphElement, FormFieldDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
FormFieldDescription.displayName = "FormFieldDescription";

export type FormFieldErrorProps = React.HTMLAttributes<HTMLParagraphElement>;

/**
 * Inline validation error message under a field — styled distinctly from
 * `FormFieldDescription`. Give it an `id` and wire the field's
 * `aria-describedby` (and `aria-invalid`) to it. Renders nothing when
 * `children` is falsy, so call sites can pass
 * `errors.field?.message` directly.
 */
export const FormFieldError = React.forwardRef<HTMLParagraphElement, FormFieldErrorProps>(
  ({ className, children, role = "alert", ...props }, ref) => {
    if (!children) return null;
    return (
      <p
        ref={ref}
        role={role}
        className={cn("text-sm font-medium text-danger", className)}
        {...props}
      >
        {children}
      </p>
    );
  },
);
FormFieldError.displayName = "FormFieldError";
