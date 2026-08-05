import Link from "next/link";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuotesUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteStatusBadge } from "./quote-status-badge";

export const metadata = { title: "My quotes" };

export default async function ProfessionalQuotesPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id here — quotes are always looked up for
  // the authenticated session's own professional profile, exactly like the
  // customer's "My requests" page looks up its own CustomerProfile.
  const quotes = await makeGetProfessionalQuotesUseCase().execute(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My quotes"
        subtitle="Quotes you've submitted to customers' service requests."
        actions={
          <Link
            href="/dashboard/professional/requests"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Find requests
          </Link>
        }
      />

      {quotes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          You haven&apos;t submitted any quotes yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <Link
                href={`/dashboard/professional/quotes/${quote.id}`}
                className="flex flex-col gap-2 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{quote.serviceRequestTitle}</h2>
                  <QuoteStatusBadge status={quote.status} />
                </div>
                <p className="text-sm text-foreground/70">{quote.serviceRequestCategoryName}</p>
                <p className="text-sm font-medium">
                  {quote.currency} {quote.totalAmount.toFixed(2)}
                </p>
                <p className="text-xs text-foreground/50">
                  Submitted {quote.createdAt.toLocaleDateString()} — updated{" "}
                  {quote.updatedAt.toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
