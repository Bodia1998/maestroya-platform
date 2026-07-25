import { requireAuth } from "@/infrastructure/auth/rbac";
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Open a dispute</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Only for jobs that are in progress, completed, or cancelled — see your job&apos;s detail page.
        </p>
      </div>
      <NewDisputeForm initialJobId={jobId ?? ""} />
    </div>
  );
}
