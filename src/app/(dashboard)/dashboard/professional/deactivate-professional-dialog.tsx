"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
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
      <Alert variant="success" role="status">
        Your professional profile has been deactivated.
      </Alert>
    );
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        Deactivate professional profile
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogHeader>
          <DialogTitle className="text-danger">This will stop new customers from finding you</DialogTitle>
          <DialogDescription>
            Existing quotes, appointments, and reviews are kept. You can be reactivated later by
            support if needed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          {serverError && (
            <Alert variant="danger" role="alert">
              {serverError}
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deactivate-confirmation">Type DEACTIVATE to confirm</Label>
            <Input
              id="deactivate-confirmation"
              aria-invalid={!!errors.confirmationText}
              aria-describedby={errors.confirmationText ? "deactivate-confirmation-error" : undefined}
              {...register("confirmationText")}
            />
            <FormFieldError id="deactivate-confirmation-error">
              {errors.confirmationText?.message}
            </FormFieldError>
          </div>

          <FormActions>
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {isSubmitting ? "Deactivating…" : "Deactivate my professional profile"}
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}
