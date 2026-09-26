import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { RegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("meta.register") };
}

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
  const t = await getTranslations("auth");

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">
          {isProfessionalIntent ? t("register.professionalHeading") : t("register.heading")}
        </h1>
        <p className="mt-1 text-sm text-foreground/70">
          {isProfessionalIntent ? t("register.professionalSubtitle") : t("register.subtitle")}
        </p>
      </div>

      <RegisterForm intendedRole={isProfessionalIntent ? "PROFESSIONAL" : "CUSTOMER"} />

      <p className="text-center text-sm text-foreground/70">
        {t.rich("register.haveAccount", {
          link: (chunks) => (
            <Link href="/auth/login" className="font-medium underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
