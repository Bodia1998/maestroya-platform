import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestForProfessionalUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteForm } from "../../../quotes/quote-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.requests.createQuote");
  return { title: t("metaTitle") };
}

/**
 * Renders the quote form only for a ServiceRequest the *authenticated*
 * professional is actually eligible to respond to —
 * GetServiceRequestForProfessionalUseCase re-checks eligibility here (not
 * just relying on the fact that the professional navigated from the
 * requests list), and CreateQuoteUseCase enforces the exact same rule again
 * server-side regardless of what this page renders.
 */
export default async function SubmitQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

  let request;
  try {
    request = await makeGetServiceRequestForProfessionalUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [t, tList] = await Promise.all([
    getTranslations("professional.requests.createQuote"),
    getTranslations("professional.requests.list"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        subtitle={request.title}
        breadcrumbs={[
          { label: tList("title"), href: "/dashboard/professional/requests" },
          { label: request.title, href: `/dashboard/professional/requests/${request.id}` },
          { label: t("title") },
        ]}
      />

      <p className="rounded-md bg-black/5 px-4 py-3 text-sm text-foreground/70">
        {t("intro")}
      </p>

      <QuoteForm mode="create" requestId={request.id} quote={null} />
    </div>
  );
}
