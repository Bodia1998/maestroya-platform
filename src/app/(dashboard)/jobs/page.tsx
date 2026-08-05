import { Briefcase } from "lucide-react";

import { makeListJobsForCustomerUseCase } from "@/application/use-cases/job/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { JobCard } from "@/components/dashboard/cards/job-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";

export const metadata = { title: "My jobs" };

export default async function JobsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — jobs are always looked up for the
  // authenticated session's own CustomerProfile, resolved inside the use
  // case itself.
  const jobs = await makeListJobsForCustomerUseCase().execute(user.id, "active");

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader title="My jobs" subtitle="The overall progress of work you've accepted a quote for." />

      {jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No active jobs"
          description="Jobs appear here once you accept a quote from a professional and work begins."
          action={<ButtonLink href="/requests">View my requests</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <JobCard
                href={`/jobs/${job.id}`}
                title={job.serviceRequestTitle}
                status={job.status}
                counterpartyName={job.counterpartyName}
              />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
