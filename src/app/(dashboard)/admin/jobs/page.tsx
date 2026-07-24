import Link from "next/link";

import { makeListAdminJobsUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";

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
      <div>
        <h1 className="text-2xl font-semibold">Appointments &amp; jobs</h1>
        <p className="mt-1 text-sm text-foreground/70">Read-only oversight of the execution lifecycle.</p>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No jobs found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Job</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Appointments</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-border/50">
                <td className="py-2 pr-4 font-mono text-xs">{job.id}</td>
                <td className="py-2 pr-4">{job.status}</td>
                <td className="py-2 pr-4">{job.appointmentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/jobs?page=${page - 1}`}>← Previous</Link> : <span />}
        {jobs.length === DEFAULT_PAGE_SIZE && <Link href={`/admin/jobs?page=${page + 1}`}>Next →</Link>}
      </div>
    </div>
  );
}
