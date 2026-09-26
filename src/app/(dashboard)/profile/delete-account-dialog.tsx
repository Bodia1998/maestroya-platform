"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { deleteAccountSchema, type DeleteAccountInput } from "@/application/dto/profile.dto";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
import { deleteAccountAction } from "./actions";

export function DeleteAccountDialog({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const t = useTranslations("profile.deleteAccount");
  const tCommon = useTranslations("common");
  const resolver = useLocalizedZodResolver(deleteAccountSchema);
  const [isOpen, setIsOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DeleteAccountInput>({
    resolver,
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

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        {t("trigger")}
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogHeader>
          <DialogTitle className="text-danger">{t("title")}</DialogTitle>
        </DialogHeader>

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
              <Label htmlFor="delete-password">{t("password")}</Label>
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
            <Label htmlFor="delete-confirmation">{t("confirmLabel", { token: "DELETE" })}</Label>
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
              {tCommon("actions.cancel")}
            </Button>
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {isSubmitting ? t("deactivating") : t("submit")}
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}
