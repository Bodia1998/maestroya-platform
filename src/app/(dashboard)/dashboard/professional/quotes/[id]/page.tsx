import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { ActionBar } from "@/components/layout/action-bar";
import { StatusTimeline } from "@/components/dashboard/status-timeline";
import { getQuoteTimelineSteps } from "@/components/dashboard/quote-timeline-steps";
import { QuoteItemsTable } from "@/components/dashboard/quote-items-table";
import { OpenConversationButton } from "../../../../messages/open-conversation-button";
import { QuoteStatusBadge } from "../quote-status-badge";
import { WithdrawQuoteDialog } from "../withdraw-quote-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.quotes.detail");
  return { title: t("metaTitle") };
}

/**
 * Professional-facing detail page for one of *their own* quotes only —
 * GetProfessionalQuoteUseCase never trusts the `id` route param as proof of
 * ownership, it re-checks against the signed-in session's own
 * ProfessionalProfile. A quote belonging to someone else surfaces as a
 * plain 404, identical to an id that doesn't exist at all.
 */
export default async function ProfessionalQuoteDetailPage({
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

  const isEditable = quote.status === "SENT" || quote.status === "VIEWED";

  const [t, tList, format] = await Promise.all([
    getTranslations("professional.quotes.detail"),
    getTranslations("professional.quotes.list"),
    getFormatter(),
  ]);
  const quoteLabel = format.number(quote.totalAmount, { style: "currency", currency: quote.currency });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={quoteLabel}
        breadcrumbs={[{ label: tList("title"), href: "/dashboard/professional/quotes" }, { label: quoteLabel }]}
        actions={<QuoteStatusBadge status={quote.status} />}
      />

      <StatusTimeline steps={getQuoteTimelineSteps(quote.status)} />

      {quote.notes && (
        <Section title={t("notes")} gap="sm">
          <p className="whitespace-pre-line text-sm text-foreground/80">{quote.notes}</p>
        </Section>
      )}

      <Section title={t("items")} gap="sm">
        <QuoteItemsTable items={quote.items} currency={quote.currency} totalAmount={quote.totalAmount} />
      </Section>

      <ResponsiveGrid cols="2" gap="md" bordered>
        <div>
          <p className="text-foreground/60">{t("validUntil")}</p>
          <p className="font-medium">
            {quote.validUntil ? format.dateTime(quote.validUntil, { dateStyle: "medium" }) : t("noExpiry")}
          </p>
        </div>
        <div>
          <p className="text-foreground/60">{t("submitted")}</p>
          <p className="font-medium">{format.dateTime(quote.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("lastUpdated")}</p>
          <p className="font-medium">{format.dateTime(quote.updatedAt, { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
      </ResponsiveGrid>

      <ActionBar itemsCenter>
        {isEditable && (
          <>
            <Link
              href={`/dashboard/professional/quotes/${quote.id}/edit`}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium hover:bg-black/5"
            >
              {t("edit")}
            </Link>
            <WithdrawQuoteDialog quoteId={quote.id} />
          </>
        )}
        <OpenConversationButton serviceRequestId={quote.serviceRequestId} label={t("messageCustomer")} />
      </ActionBar>
    </div>
  );
}
