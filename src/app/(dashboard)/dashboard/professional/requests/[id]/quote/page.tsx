import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestForProfessionalUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuoteForm } from "../../../quotes/quote-form";

export const metadata = { title: "Create quote" };

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

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Create quote"
        subtitle={request.title}
        breadcrumbs={[
          { label: "Available requests", href: "/dashboard/professional/requests" },
          { label: request.title, href: `/dashboard/professional/requests/${request.id}` },
          { label: "Create quote" },
        ]}
      />

      <p className="rounded-md bg-black/5 px-4 py-3 text-sm text-foreground/70">
        This is a customer&apos;s service request. Create a quote describing the work and materials you propose, and
        the price you&apos;re offering to complete it.
      </p>

      <QuoteForm mode="create" requestId={request.id} quote={null} />
    </div>
  );
}
