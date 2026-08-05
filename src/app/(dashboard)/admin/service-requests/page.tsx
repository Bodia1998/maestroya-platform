import Link from "next/link";

import { makeListAdminServiceRequestsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";

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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No service requests found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Title</th>
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Quotes</th>
              <th className="py-2 pr-4">Jobs</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{request.title}</td>
                <td className="py-2 pr-4">{request.customerName ?? "—"}</td>
                <td className="py-2 pr-4">{request.status}</td>
                <td className="py-2 pr-4">{request.quoteCount}</td>
                <td className="py-2 pr-4">{request.jobCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/service-requests?page=${page - 1}`}>← Previous</Link> : <span />}
        {requests.length === DEFAULT_PAGE_SIZE && (
          <Link href={`/admin/service-requests?page=${page + 1}`}>Next →</Link>
        )}
      </div>
    </div>
  );
}
