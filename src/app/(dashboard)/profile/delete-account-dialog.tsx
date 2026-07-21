"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
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
      className="flex flex-col gap-4 rounded-md border border-red-200 bg-red-50/50 p-4"
    >
      <h3 id="delete-account-title" className="text-sm font-semibold text-red-700">
        This will deactivate your account
      </h3>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
        {serverError && (
          <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        {/* Only accounts with a password have anything to confirm this
            way — OAuth-only accounts have no password to enter, and
            requiring one would be unsatisfiable, not just inconvenient. */}
        {hasPassword && (
          <div className="flex flex-col gap-1">
            <label htmlFor="delete-password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="delete-password"
              type="password"
              className="h-10 rounded-md border border-border px-3 text-sm"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="delete-confirmation" className="text-sm font-medium">
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirmation"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("confirmationText")}
          />
          {errors.confirmationText && (
            <p className="text-xs text-red-600">{errors.confirmationText.message}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            {isSubmitting ? "Deactivating…" : "Deactivate my account"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
