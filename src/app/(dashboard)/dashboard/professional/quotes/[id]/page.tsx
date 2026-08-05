import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
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

  const quoteLabel = `${quote.currency} ${quote.totalAmount.toFixed(2)}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={quoteLabel}
        breadcrumbs={[{ label: "My quotes", href: "/dashboard/professional/quotes" }, { label: quoteLabel }]}
        actions={<QuoteStatusBadge status={quote.status} />}
      />

      {quote.notes && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Notes / proposal</h2>
          <p className="whitespace-pre-line text-sm text-foreground/80">{quote.notes}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/60">
              <th className="py-2">Description</th>
              <th className="py-2">Type</th>
              <th className="py-2">Qty</th>
              <th className="py-2">Unit price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item) => (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2">{item.description}</td>
                <td className="py-2">
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-foreground/70">
                    {item.category === "MATERIALS" ? "Materials" : "Labor"}
                  </span>
                </td>
                <td className="py-2">{item.quantity}</td>
                <td className="py-2">
                  {quote.currency} {item.unitPrice.toFixed(2)}
                </td>
                <td className="py-2 text-right">
                  {quote.currency} {item.amount.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 text-sm">
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
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
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
      </section>
    </div>
  );
}
