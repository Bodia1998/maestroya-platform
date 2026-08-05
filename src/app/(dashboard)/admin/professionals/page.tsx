import { Award } from "lucide-react";

import { makeListAdminProfessionalsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";

export const metadata = { title: "Admin — Professionals" };

type SearchParams = Promise<{ page?: string; search?: string }>;

/** Admin Panel module (Module 16): read-only professional oversight. No
 *  verification workflow here — that's Module 17 (see the module spec's
 *  5.3 boundary). */
export default async function AdminProfessionalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const search = params.search?.trim() || undefined;
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const professionals = await makeListAdminProfessionalsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset, search });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Professionals" subtitle="Read-only oversight of professional profiles." />

      <form method="get" className="flex gap-2">
        <SearchInput name="search" defaultValue={search} placeholder="Search by business name, name, or email" className="flex-1" />
        <button type="submit" className="h-10 shrink-0 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted">
          Search
        </button>
      </form>

      {professionals.length === 0 ? (
        <EmptyState icon={Award} title="No professionals found" description="Try a different search term." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Business name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Verification</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Portfolio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {professionals.map((pro) => (
                <tr key={pro.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">{pro.businessName ?? "—"}</td>
                  <td className="px-4 py-3">{pro.userName ?? pro.userEmail ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={pro.status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={pro.verificationStatus} />
                  </td>
                  <td className="px-4 py-3">
                    {pro.averageRating !== null ? `${pro.averageRating} (${pro.reviewCount})` : "—"}
                  </td>
                  <td className="px-4 py-3">{pro.portfolioItemCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={professionals.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/professionals?page=${p}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
      />
    </div>
  );
}
