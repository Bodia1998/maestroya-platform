import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteForm } from "../../quote-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.quotes.edit");
  return { title: t("metaTitle") };
}

/**
 * Only ever rendered for a quote in an editable (SENT/VIEWED) status — this
 * page 404s otherwise (defense in depth; UpdateQuoteUseCase enforces the
 * same rule server-side regardless of what this page shows).
 */
export default async function EditQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

  let quote;
  try {
    quote = await makeGetProfessionalQuoteUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (quote.status !== "SENT" && quote.status !== "VIEWED") {
    notFound();
  }

  const [t, tList, format] = await Promise.all([
    getTranslations("professional.quotes.edit"),
    getTranslations("professional.quotes.list"),
    getFormatter(),
  ]);
  const quoteLabel = format.number(quote.totalAmount, { style: "currency", currency: quote.currency });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        breadcrumbs={[
          { label: tList("title"), href: "/dashboard/professional/quotes" },
          { label: quoteLabel, href: `/dashboard/professional/quotes/${quote.id}` },
          { label: t("title") },
        ]}
      />

      <QuoteForm mode="edit" quote={quote} />
    </div>
  );
}
