"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/application/dto/auth.dto";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
import { forgotPasswordAction } from "../actions";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const [serverError, setServerError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: useLocalizedZodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(data: ForgotPasswordInput) {
    setServerError(null);
    const result = await forgotPasswordAction(data);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSucceeded(true);
  }

  if (succeeded) {
    return (
      <p role="status" className="rounded-md bg-green-50 px-3 py-3 text-sm text-green-700">
        {t("forgotPassword.success")}
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

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          {t("forgotPassword.emailLabel")}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("email")}
        />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
      </Button>
    </form>
  );
}
