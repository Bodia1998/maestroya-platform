import Link from "next/link";

import { makeListDisputesAgainstMeUseCase, makeListMyDisputesUseCase } from "@/application/use-cases/dispute/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";

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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Disputes</h1>
          <p className="mt-1 text-sm text-foreground/70">Cases you&apos;ve opened, and cases opened about your work.</p>
        </div>
        <Link href="/jobs" className="text-sm underline">
          Open a dispute from a job
        </Link>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-medium">Opened by me</h2>
        {mine.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-foreground/70">
            You haven&apos;t opened any disputes.
          </p>
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
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-foreground/70">
            No disputes have been opened about your work.
          </p>
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
