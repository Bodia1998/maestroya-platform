import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewDisputeForm } from "./new-dispute-form";

export async function generateMetadata() {
  const t = await getTranslations("customer.disputes");
  return { title: t("new.title") };
}

/** Module 21 — Disputes & Support: minimal "open a dispute" page, reached
 *  from a job's detail page with `?jobId=<id>`. `jobId` is only a UX
 *  convenience pre-fill — CreateDisputeUseCase always re-verifies the
 *  caller is actually a party to that Job server-side. */
export default async function NewDisputePage({ searchParams }: { searchParams: Promise<{ jobId?: string }> }) {
  await requireAuth();
  const { jobId } = await searchParams;
  const t = await getTranslations("customer.disputes");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("new.title")}
        subtitle={t("new.subtitle")}
        breadcrumbs={[{ label: t("list.metaTitle"), href: "/disputes" }, { label: t("new.title") }]}
      />
      <NewDisputeForm initialJobId={jobId ?? ""} />
    </div>
  );
}
