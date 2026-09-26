import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { makeGetServiceRequestQuotesUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteItemsTable, formatMoney } from "@/components/dashboard/quote-items-table";
import { OpenConversationButton } from "../../../messages/open-conversation-button";
import { QuoteStatusBadge } from "../../../dashboard/professional/quotes/quote-status-badge";
import { AcceptQuoteDialog } from "./accept-quote-dialog";

export async function generateMetadata() {
  const t = await getTranslations("customer.quotes");
  return { title: t("title") };
}

/**
 * Customer-facing view of the Quotes received for *their own* Service
 * Request only — GetServiceRequestQuotesUseCase never trusts the `id` route
 * param as proof of ownership, it re-checks against the signed-in session's
 * own CustomerProfile, exactly like the request detail page. Accepting a
 * quote (see AcceptQuoteDialog) is only offered while the request is still
 * PUBLISHED and the individual quote is still SENT/VIEWED — AcceptQuoteUseCase
 * re-validates both independently regardless of what this page renders.
 */
export default async function ServiceRequestQuotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

  let request;
  try {
    request = await makeGetServiceRequestUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [quotes, t, tRequests, locale] = await Promise.all([
    makeGetServiceRequestQuotesUseCase().execute(user.id, id),
    getTranslations("customer.quotes"),
    getTranslations("customer.requests"),
    getLocale(),
  ]);
  const verificationLabel = (status: string): string =>
    t.has(`verification.${status}` as never) ? t(`verification.${status}` as never) : status;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        breadcrumbs={[
          { label: tRequests("list.title"), href: "/requests" },
          { label: request.title, href: `/requests/${id}` },
          { label: t("breadcrumb") },
        ]}
      />

      {quotes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {quotes.map((quote) => (
            <li key={quote.id} className="flex flex-col gap-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {quote.professional.profileImageUrl ? (
                    <Image
                      src={quote.professional.profileImageUrl}
                      alt={quote.professional.displayName}
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-black/10" aria-hidden="true" />
                  )}
                  <div>
                    <p className="font-medium">{quote.professional.displayName}</p>
                    <p className="text-xs text-foreground/60">
                      {verificationLabel(quote.professional.verificationStatus)}
                    </p>
                  </div>
                </div>
                <QuoteStatusBadge status={quote.status} />
              </div>

              <p className="text-lg font-semibold">{formatMoney(quote.totalAmount, quote.currency, locale)}</p>

              {quote.notes && <p className="whitespace-pre-line text-sm text-foreground/80">{quote.notes}</p>}

              <QuoteItemsTable items={quote.items} currency={quote.currency} />

              <p className="text-xs text-foreground/50">
                {quote.validUntil
                  ? t("metaWithValidity", {
                      validUntil: quote.validUntil,
                      created: quote.createdAt,
                      updated: quote.updatedAt,
                    })
                  : t("meta", { created: quote.createdAt, updated: quote.updatedAt })}
              </p>

              <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
                {request.status === "PUBLISHED" && (quote.status === "SENT" || quote.status === "VIEWED") && (
                  <AcceptQuoteDialog requestId={id} quoteId={quote.id} />
                )}
                <OpenConversationButton
                  serviceRequestId={id}
                  professionalProfileId={quote.professional.id}
                  label={t("messageProfessional", { name: quote.professional.displayName })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
