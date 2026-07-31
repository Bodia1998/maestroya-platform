import Link from "next/link";

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
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { intent } = await searchParams;
  const isProfessionalIntent = intent === "professional";

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
