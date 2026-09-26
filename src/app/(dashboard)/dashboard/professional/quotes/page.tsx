import { Award } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuotesUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteCard } from "@/components/dashboard/cards/quote-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCategoryNameLocalizer } from "../category-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.quotes.list");
  return { title: t("metaTitle") };
}

export default async function ProfessionalQuotesPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id here — quotes are always looked up for
  // the authenticated session's own professional profile, exactly like the
  // customer's "My requests" page looks up its own CustomerProfile.
  const [quotes, t, format, categories] = await Promise.all([
    makeGetProfessionalQuotesUseCase().execute(user.id),
    getTranslations("professional.quotes.list"),
    getFormatter(),
    getCategoryNameLocalizer(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<ButtonLink href="/dashboard/professional/requests">{t("findRequests")}</ButtonLink>}
      />

      {quotes.length === 0 ? (
        <EmptyState
          icon={Award}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<ButtonLink href="/dashboard/professional/requests">{t("browseRequests")}</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <QuoteCard
                href={`/dashboard/professional/quotes/${quote.id}`}
                title={quote.serviceRequestTitle}
                status={quote.status}
                categoryName={categories.byName(quote.serviceRequestCategoryName)}
                amountLabel={format.number(quote.totalAmount, { style: "currency", currency: quote.currency })}
                createdAt={quote.createdAt}
                updatedAt={quote.updatedAt}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
