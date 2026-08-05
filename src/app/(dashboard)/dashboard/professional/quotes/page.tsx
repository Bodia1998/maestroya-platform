import { Award } from "lucide-react";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuotesUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteCard } from "@/components/dashboard/cards/quote-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";

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
        actions={<ButtonLink href="/dashboard/professional/requests">Find requests</ButtonLink>}
      />

      {quotes.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No quotes submitted yet"
          description="Browse open service requests and send your first quote."
          action={<ButtonLink href="/dashboard/professional/requests">Browse requests</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <QuoteCard
                href={`/dashboard/professional/quotes/${quote.id}`}
                title={quote.serviceRequestTitle}
                status={quote.status}
                categoryName={quote.serviceRequestCategoryName}
                amountLabel={`${quote.currency} ${quote.totalAmount.toFixed(2)}`}
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
