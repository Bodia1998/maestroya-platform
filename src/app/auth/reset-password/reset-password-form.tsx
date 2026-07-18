"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { resetPasswordSchema, type ResetPasswordInput } from "@/application/dto/auth.dto";
import { resetPasswordAction } from "../actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  async function onSubmit(data: ResetPasswordInput) {
    setServerError(null);
    const result = await resetPasswordAction(data);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSucceeded(true);
  }

  if (succeeded) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md bg-green-50 px-3 py-3 text-sm text-green-700">
          Password reset. You&apos;ve been signed out everywhere for security — log in with your
          new password.
        </p>
        <Link href="/auth/login">
          <Button className="w-full">Go to login</Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <input type="hidden" {...register("token")} />

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          New password
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
          Confirm new password
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
        {isSubmitting ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}
