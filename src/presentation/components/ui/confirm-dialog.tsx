"use client";

import * as React from "react";

import type { ButtonVariantProps } from "./button-variants";
import { Button } from "./button";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./dialog";

export interface ConfirmDialogResult {
  success: boolean;
  error?: string;
}

export interface ConfirmDialogProps {
  /** Label for the button that opens the dialog. */
  triggerLabel: string;
  triggerVariant?: ButtonVariantProps["variant"];
  triggerClassName?: string;
  title: string;
  description?: React.ReactNode;
  /** Extra body content rendered between the description and the error message — e.g. a cancellation-reason select. */
  children?: React.ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  /** Reddens the confirm button and title for destructive actions (withdraw, cancel, reject). Defaults to non-destructive styling. */
  destructive?: boolean;
  onConfirm: () => Promise<ConfirmDialogResult>;
  /** Called whenever the dialog closes, whether confirmed, cancelled, or dismissed — e.g. to reset form fields in `children`. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Shared confirm-then-submit dialog — replaces four hand-rolled, near-
 * identical `role="dialog"` blocks that weren't actually modal (no portal,
 * no focus handling, no Escape/backdrop dismissal) despite claiming
 * `aria-modal="true"`:
 *   - (dashboard)/requests/[id]/quotes/accept-quote-dialog.tsx
 *   - (dashboard)/dashboard/professional/quotes/withdraw-quote-dialog.tsx
 *   - (dashboard)/requests/[id]/cancel-service-request-dialog.tsx
 *   - (dashboard)/appointments/[id]/appointment-actions.tsx's `CancelDialog`
 *
 * Built on the existing `Dialog` primitive (Module 30.1) so every one of
 * these now gets real modal behavior (portal, Escape-to-close, backdrop
 * click, focus inside the dialog) for free. Presentation-only: `onConfirm`
 * is whatever server action the caller already had — this component never
 * decides what "confirm" does, only how the confirmation step looks.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = "outline",
  triggerClassName,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
    onOpenChange?.(next);
  }

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);
    const result = await onConfirm();
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "Something went wrong. Please try again.");
      return;
    }
    handleOpenChange(false);
  }

  return (
    <>
      <Button type="button" variant={triggerVariant} className={triggerClassName} onClick={() => handleOpenChange(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogHeader>
          <DialogTitle className={destructive ? "text-danger" : undefined}>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        {error && (
          <p role="alert" className="mt-4 rounded-md bg-danger-muted px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? "danger" : "default"} disabled={isSubmitting} onClick={handleConfirm}>
            {isSubmitting ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
