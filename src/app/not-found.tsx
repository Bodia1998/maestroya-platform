import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("marketing");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      {/* i18n-ignore: HTTP status code, same in every language */}
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="text-foreground/70">{t("notFound.message")}</p>
      <Link href="/" className="text-sm font-medium underline">
        {t("notFound.backHome")}
      </Link>
    </main>
  );
}
