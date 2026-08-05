import { LifeBuoy } from "lucide-react";

import { listAdminSupportTicketsAction } from "./actions";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata = { title: "Admin — Support tickets" };

type SearchParams = Promise<{ page?: string; search?: string }>;

/** Module 21 — Disputes & Support: admin support-ticket queue — mirrors
 *  admin/disputes/page.tsx. The `listAdminSupportTicketsSchema` DTO already
 *  supports `search`/`offset`/`limit`; this page previously only ever
 *  fetched a fixed first 50 tickets with no way to search or see more. */
export default async function AdminSupportTicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const { page: pageParam, search } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const result = await listAdminSupportTicketsAction({ search, limit: DEFAULT_PAGE_SIZE, offset });
  const tickets = result.success ? result.data : [];

  const qs = (p: number) => `/admin/support-tickets?page=${p}${search ? `&search=${encodeURIComponent(search)}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Support tickets" subtitle="Customer/professional support requests." />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label="Search support tickets">
        <SearchInput
          name="search"
          defaultValue={search}
          placeholder="Search ticket number or subject"
          aria-label="Search ticket number or subject"
          className="flex-1 min-w-[200px]"
        />
      </AdminFilterForm>

      {tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No tickets found" description="Support tickets will appear here." />
      ) : (
        <AdminDataTable caption="Support tickets" minWidth={560}>
          <AdminTableHeadRow>
            <AdminTh>Ticket</AdminTh>
            <AdminTh>Subject</AdminTh>
            <AdminTh>Category</AdminTh>
            <AdminTh>Status</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {tickets.map((t) => (
              <AdminTableRow key={t.id}>
                <td className="px-4 py-3">
                  <ButtonLink
                    href={`/admin/support-tickets/${t.id}`}
                    variant="link"
                    className="h-auto p-0 font-medium"
                  >
                    {t.ticketNumber}
                  </ButtonLink>
                </td>
                <td className="px-4 py-3">{t.subject}</td>
                <td className="px-4 py-3">{t.category}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.status} />
                </td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={tickets.length === DEFAULT_PAGE_SIZE} buildHref={qs} />
    </div>
  );
}
