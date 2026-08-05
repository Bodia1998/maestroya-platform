import Link from "next/link";

import { reactivateCompanyFormAction, suspendCompanyFormAction } from "@/app/(dashboard)/admin/companies/actions";
import { makeListAdminCompaniesUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";

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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No companies found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Legal name</th>
              <th className="py-2 pr-4">Owner</th>
              <th className="py-2 pr-4">Members</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Verified</th>
              <th className="py-2 pr-4">Rating</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id} className="border-b border-border/50">
                <td className="py-2 pr-4">
                  <Link href={`/admin/companies/${company.id}`} className="underline">
                    {company.tradeName ?? company.legalName}
                  </Link>
                </td>
                <td className="py-2 pr-4">{company.ownerName ?? company.ownerEmail ?? "—"}</td>
                <td className="py-2 pr-4">{company.memberCount}</td>
                <td className="py-2 pr-4">{company.status}</td>
                <td className="py-2 pr-4">{company.isVerified ? "Yes" : "No"}</td>
                <td className="py-2 pr-4">
                  {company.averageRating !== null ? `${company.averageRating} (${company.reviewCount})` : "—"}
                </td>
                <td className="py-2 pr-4">
                  <div className="flex gap-2">
                    {(company.status === "ACTIVE" || company.status === "PENDING") && (
                      <form action={suspendCompanyFormAction.bind(null, company.id)}>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                          Suspend
                        </button>
                      </form>
                    )}
                    {company.status === "SUSPENDED" && (
                      <form action={reactivateCompanyFormAction.bind(null, company.id)}>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
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
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/companies?${qs(`page=${page - 1}`)}`}>← Previous</Link> : <span />}
        {companies.length === DEFAULT_PAGE_SIZE && (
          <Link href={`/admin/companies?${qs(`page=${page + 1}`)}`}>Next →</Link>
        )}
      </div>
    </div>
  );
}
