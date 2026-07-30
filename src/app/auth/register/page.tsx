import Link from "next/link";

import { RegisterForm } from "./register-form";

export const metadata = { title: "Create account" };

/**
 * Professional Onboarding: `?intent=professional` is how the "Soy
 * profesional" CTA (professional-cta.tsx) signals registration should be
 * tagged with `signupIntent: "PROFESSIONAL"` (see auth.dto.ts/
 * RegisterUserUseCase) — anything else (missing, a typo, "customer") is
 * treated as the ordinary default, never an error, since this is a
 * routing hint, not a validated parameter.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { intent } = await searchParams;
  const isProfessionalIntent = intent === "professional";

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">
          {isProfessionalIntent ? "Join as a professional" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-foreground/70">
          {isProfessionalIntent
            ? "Create your account, then set up your professional profile."
            : "Find trusted professionals for your home."}
        </p>
      </div>

      <RegisterForm intendedRole={isProfessionalIntent ? "PROFESSIONAL" : "CUSTOMER"} />

      <p className="text-center text-sm text-foreground/70">
        Already have an account?{" "}
        <Link href="/auth/login" className="font-medium underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
