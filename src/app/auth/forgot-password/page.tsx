import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("meta.forgotPassword") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{t("forgotPassword.heading")}</h1>
        <p className="mt-1 text-sm text-foreground/70">
          {t("forgotPassword.subtitle")}
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-center text-sm text-foreground/70">
        <Link href="/auth/login" className="font-medium underline">
          {t("forgotPassword.backToLogin")}
        </Link>
      </p>
    </div>
  );
}
