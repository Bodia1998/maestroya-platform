import Link from "next/link";
import { Building2 } from "lucide-react";

import { reactivateCompanyFormAction, suspendCompanyFormAction } from "@/app/(dashboard)/admin/companies/actions";
import { makeListAdminCompaniesUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Admin — Companies" };

type SearchParams = Promise<{ page?: string; search?: string; status?: string }>;

/** Module 18 — Company Professional: admin company oversight — list,
 *  search, filter by status, suspend/reactivate. Same shape as
 *  admin/professionals/page.tsx + admin/users/page.tsx's mutation forms. */
export default async function AdminCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const search = params.search?.trim() || undefined;
  const status = params.status?.trim() || undefined;
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const companies = await makeListAdminCompaniesUseCase().execute({
    limit: DEFAULT_PAGE_SIZE,
    offset,
    search,
    status: status as never,
  });

  const qs = (extra: string) => {
    const parts = [extra];
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    if (status) parts.push(`status=${encodeURIComponent(status)}`);
    return parts.join("&");
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Companies" subtitle="Company profiles, owners, verification, and status." />

      <form method="get" className="flex gap-2">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search by legal/trade name, owner name, or email"
          className="h-10 flex-1 rounded-md border border-border px-3 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-border px-2 text-sm">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
        <button type="submit" className="h-10 rounded-md border border-border px-4 text-sm">
          Filter
        </button>
      </form>

      {companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies found" description="Try a different search or filter." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Legal name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Verified</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {companies.map((company) => (
                <tr key={company.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/companies/${company.id}`} className="font-medium text-primary hover:underline">
                      {company.tradeName ?? company.legalName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{company.ownerName ?? company.ownerEmail ?? "—"}</td>
                  <td className="px-4 py-3">{company.memberCount}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={company.status} />
                  </td>
                  <td className="px-4 py-3">{company.isVerified ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    {company.averageRating !== null ? `${company.averageRating} (${company.reviewCount})` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {(company.status === "ACTIVE" || company.status === "PENDING") && (
                        <form action={suspendCompanyFormAction.bind(null, company.id)}>
                          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted">
                            Suspend
                          </button>
                        </form>
                      )}
                      {company.status === "SUSPENDED" && (
                        <form action={reactivateCompanyFormAction.bind(null, company.id)}>
                          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted">
                            Reactivate
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={companies.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/companies?${qs(`page=${p}`)}`}
      />
    </div>
  );
}
