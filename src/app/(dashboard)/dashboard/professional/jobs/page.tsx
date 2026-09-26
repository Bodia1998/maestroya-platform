import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { makeListJobsForProfessionalUseCase } from "@/application/use-cases/job/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { JobStatusBadge } from "@/app/(dashboard)/jobs/job-status-badge";
import { PageHeader } from "@/components/dashboard/page-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.jobs.list");
  return { title: t("metaTitle") };
}

export default async function ProfessionalJobsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — resolved to the caller's own
  // ProfessionalProfile inside the use case, same convention as the
  // customer-side list.
  const [jobs, t] = await Promise.all([
    makeListJobsForProfessionalUseCase().execute(user.id, "active"),
    getTranslations("professional.jobs.list"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {jobs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/dashboard/professional/jobs/${job.id}`}
                className="flex flex-col gap-2 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{job.serviceRequestTitle}</h2>
                  <JobStatusBadge status={job.status} />
                </div>
                {job.counterpartyName && (
                  <p className="text-sm text-foreground/70">{t("withCounterparty", { name: job.counterpartyName })}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
