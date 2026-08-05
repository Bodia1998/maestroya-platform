import { FileText } from "lucide-react";

import { makeListAdminServiceRequestsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
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
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Quotes</th>
                <th className="px-4 py-3">Jobs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((request) => (
                <tr key={request.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">{request.title}</td>
                  <td className="px-4 py-3">{request.customerName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={request.status} />
                  </td>
                  <td className="px-4 py-3">{request.quoteCount}</td>
                  <td className="px-4 py-3">{request.jobCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={requests.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/service-requests?page=${p}`}
      />
    </div>
  );
}
