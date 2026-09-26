import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { makeListDisputesAgainstMeUseCase, makeListMyDisputesUseCase } from "@/application/use-cases/dispute/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/typography";
import { PageContainer } from "@/components/layout/page-container";

export async function generateMetadata() {
  const t = await getTranslations("customer.disputes");
  return { title: t("list.metaTitle") };
}

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
  const [mine, againstMe, t] = await Promise.all([
    makeListMyDisputesUseCase().execute(user.id, { limit: 50, offset: 0 }),
    makeListDisputesAgainstMeUseCase().execute(user.id),
    getTranslations("customer.disputes"),
  ]);
  // Statuses not covered by `enums.status` (WAITING_FOR_*) get a label from this namespace.
  const statusLabel = (status: string): string | undefined =>
    t.has(`status.${status}` as never) ? t(`status.${status}` as never) : undefined;

  return (
    <PageContainer maxWidth="3xl">
      <PageHeader
        title={t("list.title")}
        subtitle={t("list.subtitle")}
        actions={
          <ButtonLink href="/jobs" variant="ghost" size="sm">
            {t("list.openFromJob")}
          </ButtonLink>
        }
      />

      <section className="flex flex-col gap-3">
        <Heading as="h2" level="h6">
          {t("list.openedByMe")}
        </Heading>
        {mine.length === 0 ? (
          <EmptyState icon={AlertTriangle} title={t("list.emptyMine.title")} description={t("list.emptyMine.description")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {mine.map((d) => (
              <li key={d.id}>
                <LinkCard href={`/disputes/${d.id}`} cardClassName="flex items-center justify-between gap-4 p-3">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-muted-foreground">{d.caseNumber}</span> — {d.title}
                  </span>
                  <StatusBadge status={d.status} label={statusLabel(d.status)} />
                </LinkCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" level="h6">
          {t("list.openedAboutMe")}
        </Heading>
        {againstMe.length === 0 ? (
          <EmptyState icon={AlertTriangle} title={t("list.emptyAgainst.title")} description={t("list.emptyAgainst.description")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {againstMe.map((d) => (
              <li key={d.id}>
                <LinkCard href={`/disputes/${d.id}`} cardClassName="flex items-center justify-between gap-4 p-3">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-muted-foreground">{d.caseNumber}</span> — {d.title}
                  </span>
                  <StatusBadge status={d.status} label={statusLabel(d.status)} />
                </LinkCard>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
