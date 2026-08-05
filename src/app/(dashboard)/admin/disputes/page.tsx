import { AlertTriangle } from "lucide-react";

import { listAdminDisputesAction } from "./actions";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata = { title: "Admin — Disputes" };

type SearchParams = Promise<{ page?: string; search?: string; status?: string }>;

/** Module 21 — Disputes & Support: admin dispute queue — list, search by
 *  case number/title, paginate (the `listAdminDisputesSchema` DTO already
 *  supports `offset`/`limit`, only this page previously fixed `limit: 50`
 *  and never read `?page=`). Filtering by priority/reason is supported by
 *  the underlying action/use case; this page keeps the UI to search +
 *  status per this module's "functional, not polished" scope decision. */
export default async function AdminDisputesPage({ searchParams }: { searchParams: SearchParams }) {
  const { page: pageParam, search, status } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const result = await listAdminDisputesAction({ search, status, limit: DEFAULT_PAGE_SIZE, offset });
  const disputes = result.success ? result.data : [];

  const qs = (p: number) => {
    const parts = [`page=${p}`];
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    if (status) parts.push(`status=${encodeURIComponent(status)}`);
    return `/admin/disputes?${parts.join("&")}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Disputes" subtitle="Customer/professional dispute cases requiring admin review." />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label="Search disputes">
        <SearchInput
          name="search"
          defaultValue={search}
          placeholder="Search case number or title"
          aria-label="Search case number or title"
          className="flex-1 min-w-[200px]"
        />
      </AdminFilterForm>

      {disputes.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No disputes found" description="Dispute cases will appear here." />
      ) : (
        <AdminDataTable caption="Disputes" minWidth={560}>
          <AdminTableHeadRow>
            <AdminTh>Case</AdminTh>
            <AdminTh>Title</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Priority</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {disputes.map((d) => (
              <AdminTableRow key={d.id}>
                <td className="px-4 py-3">
                  <ButtonLink
                    href={`/admin/disputes/${d.id}`}
                    variant="link"
                    className="h-auto p-0 font-medium"
                  >
                    {d.caseNumber}
                  </ButtonLink>
                </td>
                <td className="px-4 py-3">{d.title}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={d.status} />
                </td>
                <td className="px-4 py-3">{d.priority}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={disputes.length === DEFAULT_PAGE_SIZE} buildHref={qs} />
    </div>
  );
}
