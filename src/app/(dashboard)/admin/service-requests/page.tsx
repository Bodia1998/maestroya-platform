import { FileText } from "lucide-react";

import { makeListAdminServiceRequestsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Admin — Service requests" };

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): read-only service request oversight —
 *  see the module spec's 5.4. No mutation is exposed here. */
export default async function AdminServiceRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const requests = await makeListAdminServiceRequestsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Service requests" subtitle="Read-only oversight of customer service requests." />

      {requests.length === 0 ? (
        <EmptyState icon={FileText} title="No service requests found" description="Customer service requests will appear here." />
      ) : (
        <AdminDataTable caption="Service requests" minWidth={600}>
          <AdminTableHeadRow>
            <AdminTh>Title</AdminTh>
            <AdminTh>Customer</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Quotes</AdminTh>
            <AdminTh>Jobs</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {requests.map((request) => (
              <AdminTableRow key={request.id}>
                <td className="px-4 py-3">{request.title}</td>
                <td className="px-4 py-3">{request.customerName ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={request.status} />
                </td>
                <td className="px-4 py-3">{request.quoteCount}</td>
                <td className="px-4 py-3">{request.jobCount}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={requests.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/service-requests?page=${p}`}
      />
    </div>
  );
}
