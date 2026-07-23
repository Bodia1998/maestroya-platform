import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/compose";
import { QuoteForm } from "../../quote-form";

export const metadata = { title: "Edit quote" };

/**
 * Only ever rendered for a quote in an editable (SENT/VIEWED) status — this
 * page 404s otherwise (defense in depth; UpdateQuoteUseCase enforces the
 * same rule server-side regardless of what this page shows).
 */
export default async function EditQuotePage({
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

  if (quote.status !== "SENT" && quote.status !== "VIEWED") {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Link
        href={`/dashboard/professional/quotes/${quote.id}`}
        className="text-sm text-foreground/70 hover:underline"
      >
        ← Back to quote
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Edit quote</h1>
        <p className="mt-1 text-sm text-foreground/70">Update your pricing or proposal details.</p>
      </div>

      <QuoteForm mode="edit" quote={quote} />
    </div>
  );
}
