import Link from "next/link";
import { Building2 } from "lucide-react";

import { reactivateCompanyFormAction, suspendCompanyFormAction } from "@/app/(dashboard)/admin/companies/actions";
import { makeListAdminCompaniesUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { AdminRowActionButton } from "@/components/dashboard/admin-row-action-button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

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

      <AdminFilterForm aria-label="Search and filter companies" submitLabel="Filter">
        <Input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search by legal/trade name, owner name, or email"
          aria-label="Search by legal/trade name, owner name, or email"
          className="h-10 flex-1 min-w-[220px]"
        />
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="h-10 w-auto">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DEACTIVATED">Deactivated</option>
        </Select>
      </AdminFilterForm>

      {companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies found" description="Try a different search or filter." />
      ) : (
        <AdminDataTable caption="Companies" minWidth={720}>
          <AdminTableHeadRow>
            <AdminTh>Legal name</AdminTh>
            <AdminTh>Owner</AdminTh>
            <AdminTh>Members</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Verified</AdminTh>
            <AdminTh>Rating</AdminTh>
            <AdminTh>Actions</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {companies.map((company) => (
              <AdminTableRow key={company.id}>
                <td className="px-4 py-3">
                  <Link href={`/admin/companies/${company.id}`} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
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
                  <div className="flex flex-wrap gap-2">
                    {(company.status === "ACTIVE" || company.status === "PENDING") && (
                      <form action={suspendCompanyFormAction.bind(null, company.id)}>
                        <AdminRowActionButton>
                          Suspend<span className="sr-only"> company {company.tradeName ?? company.legalName}</span>
                        </AdminRowActionButton>
                      </form>
                    )}
                    {company.status === "SUSPENDED" && (
                      <form action={reactivateCompanyFormAction.bind(null, company.id)}>
                        <AdminRowActionButton>
                          Reactivate<span className="sr-only"> company {company.tradeName ?? company.legalName}</span>
                        </AdminRowActionButton>
                      </form>
                    )}
                  </div>
                </td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={companies.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/companies?${qs(`page=${p}`)}`}
      />
    </div>
  );
}
