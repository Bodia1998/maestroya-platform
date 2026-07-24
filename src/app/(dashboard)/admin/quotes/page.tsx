import Link from "next/link";

import { makeListAdminQuotesUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";

export const metadata = { title: "Admin — Quotes" };

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): read-only quote oversight — see the
 *  module spec's 5.5. No mutation is exposed here. */
export default async function AdminQuotesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const quotes = await makeListAdminQuotesUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Quotes</h1>
        <p className="mt-1 text-sm text-foreground/70">Read-only oversight of quotes.</p>
      </div>

      {quotes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No quotes found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Request</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              <tr key={quote.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{quote.serviceRequestTitle}</td>
                <td className="py-2 pr-4">{quote.status}</td>
                <td className="py-2 pr-4">
                  {quote.totalAmount.toFixed(2)} {quote.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/quotes?page=${page - 1}`}>← Previous</Link> : <span />}
        {quotes.length === DEFAULT_PAGE_SIZE && <Link href={`/admin/quotes?page=${page + 1}`}>Next →</Link>}
      </div>
    </div>
  );
}
