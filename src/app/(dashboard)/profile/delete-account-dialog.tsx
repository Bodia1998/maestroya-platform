"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { deleteAccountSchema, type DeleteAccountInput } from "@/application/dto/profile.dto";
import { deleteAccountAction } from "./actions";

export function DeleteAccountDialog({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DeleteAccountInput>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: "", confirmationText: "DELETE" },
  });

  async function onSubmit(data: DeleteAccountInput) {
    setServerError(null);
    const result = await deleteAccountAction(data);

    if (!result.success) {
      setServerError(result.error);
      return;
    }

    router.push("/auth/logout");
  }

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        Deactivate account
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      className="flex flex-col gap-4 rounded-lg border border-danger/30 bg-danger-muted/40 p-4"
    >
      <h3 id="delete-account-title" className="text-sm font-semibold text-danger">
        This will deactivate your account
      </h3>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        {serverError && (
          <Alert variant="danger" role="alert">
            {serverError}
          </Alert>
        )}

        {/* Only accounts with a password have anything to confirm this
            way — OAuth-only accounts have no password to enter, and
            requiring one would be unsatisfiable, not just inconvenient. */}
        {hasPassword && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-password">Password</Label>
            <PasswordInput
              id="delete-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "delete-password-error" : undefined}
              {...register("password")}
            />
            <FormFieldError id="delete-password-error">{errors.password?.message}</FormFieldError>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delete-confirmation">Type DELETE to confirm</Label>
          <Input
            id="delete-confirmation"
            aria-invalid={!!errors.confirmationText}
            aria-describedby={errors.confirmationText ? "delete-confirmation-error" : undefined}
            {...register("confirmationText")}
          />
          <FormFieldError id="delete-confirmation-error">{errors.confirmationText?.message}</FormFieldError>
        </div>

        <FormActions>
          <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            {isSubmitting ? "Deactivating…" : "Deactivate my account"}
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
