/**
 * Root loading UI, shown automatically by Next.js while a Server
 * Component's async work (data fetching) is in flight — no manual
 * Suspense wiring needed at this level.
 */
import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("common");
  return (
    <main className="flex min-h-screen items-center justify-center" role="status" aria-label={t("states.loading")}>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" aria-hidden />
    </main>
  );
}
