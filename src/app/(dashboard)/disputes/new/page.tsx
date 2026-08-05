import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewDisputeForm } from "./new-dispute-form";

export const metadata = { title: "Open a dispute" };

/** Module 21 — Disputes & Support: minimal "open a dispute" page, reached
 *  from a job's detail page with `?jobId=<id>`. `jobId` is only a UX
 *  convenience pre-fill — CreateDisputeUseCase always re-verifies the
 *  caller is actually a party to that Job server-side. */
export default async function NewDisputePage({ searchParams }: { searchParams: Promise<{ jobId?: string }> }) {
  await requireAuth();
  const { jobId } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Open a dispute"
        subtitle="Only for jobs that are in progress, completed, or cancelled — see your job's detail page."
        breadcrumbs={[{ label: "My disputes", href: "/disputes" }, { label: "Open a dispute" }]}
      />
      <NewDisputeForm initialJobId={jobId ?? ""} />
    </div>
  );
}
