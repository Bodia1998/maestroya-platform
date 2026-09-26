import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("meta.resetPassword") };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{t("resetPassword.heading")}</h1>
        <p className="mt-1 text-sm text-foreground/70">{t("resetPassword.subtitle")}</p>
      </div>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("resetPassword.missingToken")}
        </p>
      )}
    </div>
  );
}
