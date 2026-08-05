import Link from "next/link";

import { makeListDisputesAgainstMeUseCase, makeListMyDisputesUseCase } from "@/application/use-cases/dispute/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "My disputes" };

/**
 * Module 21 — Disputes & Support: minimal customer/professional-facing
 * "my disputes" page — lists both disputes the caller opened and disputes
 * opened against them (see ListMyDisputesUseCase / ListDisputesAgainstMeUseCase).
 * Kept intentionally simple (no client-side filtering UI) — the priority
 * for this module is correct domain/application/infrastructure layers and
 * tests, not UI polish.
 */
export default async function DisputesPage() {
  const user = await requireAuth();
  const [mine, againstMe] = await Promise.all([
    makeListMyDisputesUseCase().execute(user.id, { limit: 50, offset: 0 }),
    makeListDisputesAgainstMeUseCase().execute(user.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title="Disputes"
        subtitle="Cases you've opened, and cases opened about your work."
        actions={
          <ButtonLink href="/jobs" variant="ghost" size="sm">
            Open a dispute from a job
          </ButtonLink>
        }
      />

      <section>
        <h2 className="mb-2 text-lg font-medium">Opened by me</h2>
        {mine.length === 0 ? (
          <EmptyState title="No disputes opened" description="You haven't opened any disputes." />
        ) : (
          <ul className="flex flex-col gap-2">
            {mine.map((d) => (
              <li key={d.id}>
                <Link href={`/disputes/${d.id}`} className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-black/5">
                  <span>
                    <span className="font-mono text-xs text-foreground/60">{d.caseNumber}</span> — {d.title}
                  </span>
                  <span className="text-xs">{d.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Opened about my work</h2>
        {againstMe.length === 0 ? (
          <EmptyState title="Nothing here" description="No disputes have been opened about your work." />
        ) : (
          <ul className="flex flex-col gap-2">
            {againstMe.map((d) => (
              <li key={d.id}>
                <Link href={`/disputes/${d.id}`} className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-black/5">
                  <span>
                    <span className="font-mono text-xs text-foreground/60">{d.caseNumber}</span> — {d.title}
                  </span>
                  <span className="text-xs">{d.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
