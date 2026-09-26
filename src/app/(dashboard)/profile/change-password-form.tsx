"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { changePasswordSchema, type ChangePasswordInput } from "@/application/dto/profile.dto";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("profile.password");
  const resolver = useLocalizedZodResolver(changePasswordSchema);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver,
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

    setSuccessMessage(t("changed"));
    reset();
  }

  if (!hasPassword) {
    return (
      <Alert variant="info">
        {t("noPassword")}
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      {serverError && (
        <Alert variant="danger" role="alert">
          {serverError}
        </Alert>
      )}
      {successMessage && (
        <Alert variant="success" role="status">
          {successMessage}
        </Alert>
      )}

      <FormSection title={t("title")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currentPassword">{t("current")}</Label>
          <PasswordInput
            id="currentPassword"
            autoComplete="current-password"
            aria-invalid={!!errors.currentPassword}
            aria-describedby={errors.currentPassword ? "currentPassword-error" : undefined}
            {...register("currentPassword")}
          />
          <FormFieldError id="currentPassword-error">{errors.currentPassword?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPassword">{t("new")}</Label>
          <PasswordInput
            id="newPassword"
            autoComplete="new-password"
            aria-invalid={!!errors.newPassword}
            aria-describedby={errors.newPassword ? "newPassword-error" : undefined}
            {...register("newPassword")}
          />
          <FormFieldError id="newPassword-error">{errors.newPassword?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmNewPassword">{t("confirm")}</Label>
          <PasswordInput
            id="confirmNewPassword"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmNewPassword}
            aria-describedby={errors.confirmNewPassword ? "confirmNewPassword-error" : undefined}
            {...register("confirmNewPassword")}
          />
          <FormFieldError id="confirmNewPassword-error">{errors.confirmNewPassword?.message}</FormFieldError>
        </div>
      </FormSection>

      <FormActions>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("changing") : t("submit")}
        </Button>
      </FormActions>
    </form>
  );
}
