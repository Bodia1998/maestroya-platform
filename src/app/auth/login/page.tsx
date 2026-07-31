import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/infrastructure/auth/rbac";
import { resolvePostLoginDestination } from "@/shared/utils/resolve-post-login-destination";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

/**
 * `?intent=professional` (from site-header.tsx's "Soy profesional" CTA)
 * only changes this page's copy — it is a login-time hint read again by
 * `LoginForm`/`resolvePostLoginDestination` to decide where a *successful*
 * login navigates to, never anything persisted or role-granting on its
 * own. The "Sign up" link below deliberately forwards the same intent so
 * someone who followed "Soy profesional" without yet having an account
 * lands on the professional registration flow instead of the plain one.
 *
 * Already-authenticated visitor: previously this page rendered the login
 * form unconditionally, regardless of session state — an already signed-in
 * user landing here (stale bookmark, browser back button, clicking a
 * "Soy profesional" link while already logged in) just saw the login form
 * again with no way forward except submitting credentials a second time.
 * Reuses the same authoritative `getCurrentUser()`/`resolvePostLoginDestination`
 * pair `/auth/post-login` uses for the exact same decision, so an
 * already-signed-in visitor is bounced to the right dashboard instead of
 * being left on the login page.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; callbackUrl?: string }>;
}) {
  const { intent, callbackUrl } = await searchParams;
  const isProfessionalIntent = intent === "professional";

  const user = await getCurrentUser();
  if (user) {
    const destination = resolvePostLoginDestination(
      { roles: user.roles, signupIntent: user.signupIntent },
      {
        explicitCallbackUrl: callbackUrl ?? null,
        defaultDestination: "/dashboard",
        loginIntent: isProfessionalIntent ? "professional" : null,
      },
    );
    redirect(destination);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{isProfessionalIntent ? "Professional log in" : "Log in"}</h1>
        <p className="mt-1 text-sm text-foreground/70">
          {isProfessionalIntent
            ? "Log in to your professional account."
            : "Welcome back to MaestroYa."}
        </p>
      </div>

      <LoginForm />

      <p className="text-center text-sm text-foreground/70">
        Don&apos;t have an account?{" "}
        <Link
          href={isProfessionalIntent ? "/auth/register?intent=professional" : "/auth/register"}
          className="font-medium underline"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
