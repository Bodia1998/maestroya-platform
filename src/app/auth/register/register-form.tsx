"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { registerSchema, type RegisterInput } from "@/application/dto/auth.dto";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
import { registerAction } from "../actions";

export function RegisterForm({
  intendedRole = "CUSTOMER",
}: {
  /** Professional Onboarding: carried from the register page's own `?intent=` read — see page.tsx. */
  intendedRole?: "CUSTOMER" | "PROFESSIONAL";
}) {
  const t = useTranslations("auth");
  const [serverError, setServerError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: useLocalizedZodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      intent: intendedRole,
    },
  });

  async function onSubmit(data: RegisterInput) {
    setServerError(null);
    const result = await registerAction({ ...data, intent: intendedRole });

    if (!result.success) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof RegisterInput, { message: messages[0] });
          }
        }
      }
      return;
    }

    setSucceeded(true);
  }

  if (succeeded) {
    return (
      <p role="status" className="rounded-md bg-green-50 px-3 py-3 text-sm text-green-700">
        {t("register.success")}
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
        <label htmlFor="name" className="text-sm font-medium">
          {t("register.nameLabel")}
        </label>
        <input
          id="name"
          autoComplete="name"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("name")}
        />
        {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          {t("register.emailLabel")}
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

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          {t("register.passwordLabel")}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("password")}
        />
        {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          {t("register.confirmPasswordLabel")}
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-xs text-red-600">{errors.confirmPassword.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("register.submitting") : t("register.submit")}
      </Button>
    </form>
  );
}
