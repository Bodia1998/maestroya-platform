import { Briefcase } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { makeListJobsForCustomerUseCase } from "@/application/use-cases/job/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { JobCard } from "@/components/dashboard/cards/job-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";

export async function generateMetadata() {
  const t = await getTranslations("jobs.list");
  return { title: t("title") };
}

export default async function JobsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — jobs are always looked up for the
  // authenticated session's own CustomerProfile, resolved inside the use
  // case itself.
  const [jobs, t] = await Promise.all([
    makeListJobsForCustomerUseCase().execute(user.id, "active"),
    getTranslations("jobs.list"),
  ]);

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={t("empty.title")}
          description={t("empty.description")}
          action={<ButtonLink href="/requests">{t("empty.action")}</ButtonLink>}
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
