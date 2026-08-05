import Link from "next/link";
import { Briefcase } from "lucide-react";

import { makeListJobsForCustomerUseCase } from "@/application/use-cases/job/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { JobStatusBadge } from "./job-status-badge";

export const metadata = { title: "My jobs" };

export default async function JobsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — jobs are always looked up for the
  // authenticated session's own CustomerProfile, resolved inside the use
  // case itself.
  const jobs = await makeListJobsForCustomerUseCase().execute(user.id, "active");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="My jobs" subtitle="The overall progress of work you've accepted a quote for." />

      {jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No active jobs" description="You have no active jobs." />
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="flex flex-col gap-2 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{job.serviceRequestTitle}</h2>
                  <JobStatusBadge status={job.status} />
                </div>
                {job.counterpartyName && <p className="text-sm text-foreground/70">with {job.counterpartyName}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
