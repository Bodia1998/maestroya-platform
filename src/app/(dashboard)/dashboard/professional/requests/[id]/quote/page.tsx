import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestForProfessionalUseCase } from "@/application/use-cases/quotes/compose";
import { QuoteForm } from "../../../quotes/quote-form";

export const metadata = { title: "Submit a quote" };

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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Link
        href={`/dashboard/professional/requests/${request.id}`}
        className="text-sm text-foreground/70 hover:underline"
      >
        ← Back to request
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Submit a quote</h1>
        <p className="mt-1 text-sm text-foreground/70">{request.title}</p>
      </div>

      <QuoteForm mode="create" requestId={request.id} quote={null} />
    </div>
  );
}
