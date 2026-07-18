"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { loginSchema, type LoginInput } from "@/application/dto/auth.dto";

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [serverError, setServerError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  async function onSubmit(data: LoginInput) {
    setServerError(null);
    const result = await signIn("credentials", {
      email: data.email,
      password: data.password,
      rememberMe: String(data.rememberMe),
      redirect: false,
      callbackUrl,
    });

    if (!result || result.error) {
      setServerError("Incorrect email or password.");
      return;
    }

    window.location.href = result.url ?? callbackUrl;
  }

  async function handleOAuth(provider: "google" | "apple" | "facebook") {
    setOauthLoading(provider);
    await signIn(provider, { callbackUrl });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {(["google", "apple", "facebook"] as const).map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            disabled={oauthLoading !== null}
            onClick={() => handleOAuth(provider)}
          >
            {oauthLoading === provider
              ? "Redirecting…"
              : `Continue with ${provider.charAt(0).toUpperCase()}${provider.slice(1)}`}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-foreground/50">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        {serverError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-red-600">{errors.email.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <a href="/auth/forgot-password" className="text-xs underline">
              Forgot password?
            </a>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-red-600">{errors.password.message}</p>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("rememberMe")} />
          Remember me
        </label>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </div>
  );
}
