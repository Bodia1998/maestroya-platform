import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { ActionBar } from "@/components/layout/action-bar";
import { StatusTimeline } from "@/components/dashboard/status-timeline";
import { getQuoteTimelineSteps } from "@/components/dashboard/quote-timeline-steps";
import { QuoteItemsTable, formatMoney } from "@/components/dashboard/quote-items-table";
import { OpenConversationButton } from "../../../../messages/open-conversation-button";
import { QuoteStatusBadge } from "../quote-status-badge";
import { WithdrawQuoteDialog } from "../withdraw-quote-dialog";

export const metadata = { title: "Quote detail" };

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

  const quoteLabel = formatMoney(quote.totalAmount, quote.currency);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={quoteLabel}
        breadcrumbs={[{ label: "My quotes", href: "/dashboard/professional/quotes" }, { label: quoteLabel }]}
        actions={<QuoteStatusBadge status={quote.status} />}
      />

      <StatusTimeline steps={getQuoteTimelineSteps(quote.status)} />

      {quote.notes && (
        <Section title="Notes / proposal" gap="sm">
          <p className="whitespace-pre-line text-sm text-foreground/80">{quote.notes}</p>
        </Section>
      )}

      <Section title="Items" gap="sm">
        <QuoteItemsTable items={quote.items} currency={quote.currency} totalAmount={quote.totalAmount} />
      </Section>

      <ResponsiveGrid cols="2" gap="md" bordered>
        <div>
          <p className="text-foreground/60">Valid until</p>
          <p className="font-medium">
            {quote.validUntil ? quote.validUntil.toLocaleDateString() : "No expiry set"}
          </p>
        </div>
        <div>
          <p className="text-foreground/60">Submitted</p>
          <p className="font-medium">{quote.createdAt.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-foreground/60">Last updated</p>
          <p className="font-medium">{quote.updatedAt.toLocaleString()}</p>
        </div>
      </ResponsiveGrid>

      <ActionBar itemsCenter>
        {isEditable && (
          <>
            <Link
              href={`/dashboard/professional/quotes/${quote.id}/edit`}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium hover:bg-black/5"
            >
              Edit quote
            </Link>
            <WithdrawQuoteDialog quoteId={quote.id} />
          </>
        )}
        <OpenConversationButton serviceRequestId={quote.serviceRequestId} label="Message customer" />
      </ActionBar>
    </div>
  );
}
