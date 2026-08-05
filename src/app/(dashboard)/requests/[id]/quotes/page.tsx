import Image from "next/image";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { makeGetServiceRequestQuotesUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { OpenConversationButton } from "../../../messages/open-conversation-button";
import { QuoteStatusBadge } from "../../../dashboard/professional/quotes/quote-status-badge";
import { AcceptQuoteDialog } from "./accept-quote-dialog";

export const metadata = { title: "Received quotes" };

const VERIFICATION_LABELS: Record<string, string> = {
  UNVERIFIED: "Not verified",
  PENDING: "Verification pending",
  VERIFIED: "Verified",
  REJECTED: "Verification rejected",
};

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

  const quotes = await makeGetServiceRequestQuotesUseCase().execute(user.id, id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Received quotes"
        subtitle="Quotes professionals have submitted for this request."
        breadcrumbs={[
          { label: "My requests", href: "/requests" },
          { label: request.title, href: `/requests/${id}` },
          { label: "Quotes" },
        ]}
      />

      {quotes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No quotes yet. Check back soon.
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
                      {VERIFICATION_LABELS[quote.professional.verificationStatus] ??
                        quote.professional.verificationStatus}
                    </p>
                  </div>
                </div>
                <QuoteStatusBadge status={quote.status} />
              </div>

              <p className="text-lg font-semibold">
                {quote.currency} {quote.totalAmount.toFixed(2)}
              </p>

              {quote.notes && <p className="whitespace-pre-line text-sm text-foreground/80">{quote.notes}</p>}

              <table className="w-full text-sm">
                <tbody>
                  {quote.items.map((item) => (
                    <tr key={item.id} className="border-t border-border/50">
                      <td className="py-1.5">{item.description}</td>
                      <td className="py-1.5 text-right text-foreground/70">
                        {item.quantity} × {quote.currency} {item.unitPrice.toFixed(2)}
                      </td>
                      <td className="py-1.5 pl-3 text-right font-medium">
                        {quote.currency} {item.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="text-xs text-foreground/50">
                {quote.validUntil ? `Valid until ${quote.validUntil.toLocaleDateString()} — ` : ""}
                Submitted {quote.createdAt.toLocaleDateString()} — updated{" "}
                {quote.updatedAt.toLocaleDateString()}
              </p>

              <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
                {request.status === "PUBLISHED" && (quote.status === "SENT" || quote.status === "VIEWED") && (
                  <AcceptQuoteDialog requestId={id} quoteId={quote.id} />
                )}
                <OpenConversationButton
                  serviceRequestId={id}
                  professionalProfileId={quote.professional.id}
                  label={`Message ${quote.professional.displayName}`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
