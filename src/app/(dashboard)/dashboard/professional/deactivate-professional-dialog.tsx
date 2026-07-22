"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  deactivateProfessionalSchema,
  type DeactivateProfessionalInput,
} from "@/application/dto/professional.dto";
import { deactivateProfessionalAction } from "./actions";

export function DeactivateProfessionalDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isDeactivated, setIsDeactivated] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DeactivateProfessionalInput>({
    resolver: zodResolver(deactivateProfessionalSchema),
    defaultValues: { confirmationText: "DEACTIVATE" },
  });

  async function onSubmit(data: DeactivateProfessionalInput) {
    setServerError(null);
    const result = await deactivateProfessionalAction(data);

    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setIsDeactivated(true);
    setIsOpen(false);
  }

  if (isDeactivated) {
    return (
      <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
        Your professional profile has been deactivated.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        Deactivate professional profile
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deactivate-professional-title"
      className="flex flex-col gap-4 rounded-md border border-red-200 bg-red-50/50 p-4"
    >
      <h3 id="deactivate-professional-title" className="text-sm font-semibold text-red-700">
        This will stop new customers from finding you
      </h3>
      <p className="text-sm text-foreground/70">
        Existing quotes, appointments, and reviews are kept. You can be reactivated later by
        support if needed.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
        {serverError && (
          <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="deactivate-confirmation" className="text-sm font-medium">
            Type DEACTIVATE to confirm
          </label>
          <input
            id="deactivate-confirmation"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("confirmationText")}
          />
          {errors.confirmationText && (
            <p className="text-xs text-red-600">{errors.confirmationText.message}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            {isSubmitting ? "Deactivating…" : "Deactivate my professional profile"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
