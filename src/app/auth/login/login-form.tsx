"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { loginSchema, type LoginInput } from "@/application/dto/auth.dto";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";

/** Provider names are brand names (i18n-ignore: not translated). */
const OAUTH_PROVIDER_NAMES = { google: "Google", apple: "Apple", facebook: "Facebook" } as const; // i18n-ignore

export function LoginForm() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const explicitCallbackUrl = searchParams.get("callbackUrl");
  const callbackUrl = explicitCallbackUrl ?? "/dashboard";
  // "Soy profesional" (site-header.tsx) links here with `?intent=professional`
  // — a *login-time* hint, distinct from the DB-backed `signupIntent` set at
  // registration. Never used to grant PROVIDER or mutate the account; it
  // only affects where a successful login navigates to next — forwarded
  // as-is to /auth/post-login, see that page's own doc comment.
  const loginIntent = searchParams.get("intent") === "professional" ? "professional" : null;
  const [serverError, setServerError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: useLocalizedZodResolver(loginSchema),
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

    if (!result || !result.ok || result.error) {
      // Same message for an unknown email and a wrong password (no account
      // enumeration) — only its language changes.
      setServerError(t("errors.invalidCredentials"));
      return;
    }

    // Professional Onboarding (and, for an already-activated professional,
    // landing straight on their own dashboard): the destination is decided
    // server-side, from the authoritative session `/auth/post-login`
    // reads on its own fresh request — never from a client-side
    // `getSession()` read here, which could occasionally still observe
    // the pre-login session for one tick (next-auth's own client cache)
    // and send the user to the wrong place or bounce them back to login.
    // See post-login/page.tsx's own doc comment for the full root-cause
    // writeup. `explicitCallbackUrl`/`loginIntent` are forwarded as query
    // params so that page can run the exact same
    // `resolvePostLoginDestination` decision this form used to make itself.
    const params = new URLSearchParams();
    if (explicitCallbackUrl) params.set("callbackUrl", explicitCallbackUrl);
    if (loginIntent) params.set("intent", loginIntent);
    const query = params.toString();
    window.location.href = `/auth/post-login${query ? `?${query}` : ""}`;
  }

  async function handleOAuth(provider: "google" | "apple" | "facebook") {
    setOauthLoading(provider);
    // Same server-authoritative destination decision as the credentials
    // path above (see /auth/post-login's doc comment) — without this, an
    // existing PROVIDER signing in via OAuth would always land on the
    // plain customer dashboard (`callbackUrl`'s own default) instead of
    // `/dashboard/professional`, since OAuth's own `redirect: true` flow
    // navigates straight to `callbackUrl` with no chance to inspect the
    // freshly-created session first.
    const params = new URLSearchParams();
    if (explicitCallbackUrl) params.set("callbackUrl", explicitCallbackUrl);
    if (loginIntent) params.set("intent", loginIntent);
    const query = params.toString();
    await signIn(provider, { callbackUrl: `/auth/post-login${query ? `?${query}` : ""}` });
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
              ? t("login.redirecting")
              : t("login.continueWith", { provider: OAUTH_PROVIDER_NAMES[provider] })}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-foreground/50">
        <div className="h-px flex-1 bg-border" />
        {t("login.or")}
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
            {t("login.emailLabel")}
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
              {t("login.passwordLabel")}
            </label>
            <a href="/auth/forgot-password" className="text-xs underline">
              {t("login.forgotPassword")}
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
          {t("login.rememberMe")}
        </label>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
    </div>
  );
}
