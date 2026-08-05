import { Briefcase } from "lucide-react";

import { makeListAdminJobsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Admin — Appointments & jobs" };

type SearchParams = Promise<{ page?: string }>;

/** Admin Panel module (Module 16): read-only appointment/job oversight —
 *  see the module spec's 5.6. No mutation is exposed here. */
export default async function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const jobs = await makeListAdminJobsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Appointments & jobs" subtitle="Read-only oversight of the execution lifecycle." />

      {jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs found" description="Jobs created from accepted quotes will appear here." />
      ) : (
        <AdminDataTable caption="Appointments and jobs" minWidth={480}>
          <AdminTableHeadRow>
            <AdminTh>Job</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Appointments</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {jobs.map((job) => (
              <AdminTableRow key={job.id}>
                <td className="px-4 py-3 font-mono text-xs">{job.id}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3">{job.appointmentCount}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={jobs.length === DEFAULT_PAGE_SIZE} buildHref={(p) => `/admin/jobs?page=${p}`} />
    </div>
  );
}
