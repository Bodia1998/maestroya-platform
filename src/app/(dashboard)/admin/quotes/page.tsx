import { FileSignature } from "lucide-react";

import { makeListAdminQuotesUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

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
      <PageHeader title="Quotes" subtitle="Read-only oversight of quotes." />

      {quotes.length === 0 ? (
        <EmptyState icon={FileSignature} title="No quotes found" description="Quotes submitted by professionals will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {quotes.map((quote) => (
                <tr key={quote.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">{quote.serviceRequestTitle}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={quote.status} />
                  </td>
                  <td className="px-4 py-3">
                    {quote.totalAmount.toFixed(2)} {quote.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTablePager page={page} hasNextPage={quotes.length === DEFAULT_PAGE_SIZE} buildHref={(p) => `/admin/quotes?page=${p}`} />
    </div>
  );
}
