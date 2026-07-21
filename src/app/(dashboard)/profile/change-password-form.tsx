"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { changePasswordSchema, type ChangePasswordInput } from "@/application/dto/profile.dto";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmNewPassword: "" },
  });

  async function onSubmit(data: ChangePasswordInput) {
    setServerError(null);
    setSuccessMessage(null);
    const result = await changePasswordAction(data);

    if (!result.success) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof ChangePasswordInput, { message: messages[0] });
          }
        }
      }
      return;
    }

    setSuccessMessage("Password changed. You've been signed out everywhere else for security.");
    reset();
  }

  if (!hasPassword) {
    return (
      <p className="rounded-md bg-black/5 px-3 py-2 text-sm text-foreground/70">
        This account signs in via a social login and has no password to change.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}
      {successMessage && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="currentPassword" className="text-sm font-medium">
          Current password
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("currentPassword")}
        />
        {errors.currentPassword && (
          <p className="text-xs text-red-600">{errors.currentPassword.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="newPassword" className="text-sm font-medium">
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("newPassword")}
        />
        {errors.newPassword && (
          <p className="text-xs text-red-600">{errors.newPassword.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirmNewPassword" className="text-sm font-medium">
          Confirm new password
        </label>
        <input
          id="confirmNewPassword"
          type="password"
          autoComplete="new-password"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("confirmNewPassword")}
        />
        {errors.confirmNewPassword && (
          <p className="text-xs text-red-600">{errors.confirmNewPassword.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
