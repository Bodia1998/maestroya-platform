import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { makeListDisputesAgainstMeUseCase, makeListMyDisputesUseCase } from "@/application/use-cases/dispute/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/typography";

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

      <section className="flex flex-col gap-3">
        <Heading as="h2" level="h6">
          Opened by me
        </Heading>
        {mine.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="No disputes opened" description="You haven't opened any disputes." />
        ) : (
          <ul className="flex flex-col gap-2">
            {mine.map((d) => (
              <li key={d.id}>
                <Link href={`/disputes/${d.id}`} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <Card className="flex items-center justify-between gap-4 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs text-muted-foreground">{d.caseNumber}</span> — {d.title}
                    </span>
                    <StatusBadge status={d.status} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" level="h6">
          Opened about my work
        </Heading>
        {againstMe.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nothing here" description="No disputes have been opened about your work." />
        ) : (
          <ul className="flex flex-col gap-2">
            {againstMe.map((d) => (
              <li key={d.id}>
                <Link href={`/disputes/${d.id}`} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <Card className="flex items-center justify-between gap-4 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs text-muted-foreground">{d.caseNumber}</span> — {d.title}
                    </span>
                    <StatusBadge status={d.status} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
