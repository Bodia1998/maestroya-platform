import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { makeVerifyEmailUseCase } from "@/application/use-cases/auth/compose";
import { Button } from "@/components/ui/button";
import { localizeActionError } from "@/presentation/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("meta.verifyEmail") };
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");

  let errorMessage: string | null = null;

  if (!token) {
    errorMessage = t("verifyEmail.missingToken");
  } else {
    try {
      await makeVerifyEmailUseCase().execute(token);
    } catch (error) {
      errorMessage = await localizeActionError(error, t("verifyEmail.failed"));
    }
  }

  return (
    <div className="flex flex-col gap-6 text-center">
      {errorMessage ? (
        <>
          <h1 className="text-2xl font-semibold">{t("verifyEmail.failedTitle")}</h1>
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{t("verifyEmail.successTitle")}</h1>
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {t("verifyEmail.success")}
          </p>
        </>
      )}
      <Link href="/auth/login">
        <Button className="w-full">{t("goToLogin")}</Button>
      </Link>
    </div>
  );
}
