import { Award } from "lucide-react";

import { makeListAdminProfessionalsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
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

      <AdminFilterForm aria-label="Search professionals">
        <SearchInput
          name="search"
          defaultValue={search}
          placeholder="Search by business name, name, or email"
          aria-label="Search by business name, name, or email"
          className="flex-1 min-w-[200px]"
        />
      </AdminFilterForm>

      {professionals.length === 0 ? (
        <EmptyState icon={Award} title="No professionals found" description="Try a different search term." />
      ) : (
        <AdminDataTable caption="Professionals" minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>Business name</AdminTh>
            <AdminTh>Owner</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Verification</AdminTh>
            <AdminTh>Rating</AdminTh>
            <AdminTh>Portfolio</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {professionals.map((pro) => (
              <AdminTableRow key={pro.id}>
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
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={professionals.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/professionals?page=${p}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
      />
    </div>
  );
}
