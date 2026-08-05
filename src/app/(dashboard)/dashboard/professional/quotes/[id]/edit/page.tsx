import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteForm } from "../../quote-form";

export const metadata = { title: "Edit quote" };

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

  const quoteLabel = `${quote.currency} ${quote.totalAmount.toFixed(2)}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Edit quote"
        subtitle="Update your pricing or proposal details."
        breadcrumbs={[
          { label: "My quotes", href: "/dashboard/professional/quotes" },
          { label: quoteLabel, href: `/dashboard/professional/quotes/${quote.id}` },
          { label: "Edit quote" },
        ]}
      />

      <QuoteForm mode="edit" quote={quote} />
    </div>
  );
}
